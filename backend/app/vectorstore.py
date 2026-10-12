import re
import threading
from functools import lru_cache

import chromadb
from chromadb.config import Settings as ChromaSettings

from .config import get_settings
from .providers import get_embedding_provider

# Chroma's first-time on-disk setup is not safe to run concurrently from indexer threads.
_init_lock = threading.RLock()


def _client():
    with _init_lock:
        return _make_client()


@lru_cache
def _make_client():
    s = get_settings()
    chroma_settings = ChromaSettings(anonymized_telemetry=False)
    if s.chroma_mode == "server":
        return chromadb.HttpClient(host=s.chroma_host, port=s.chroma_port,
                                   settings=chroma_settings)
    return chromadb.PersistentClient(path=str(s.data_dir / "chroma"), settings=chroma_settings)


def heartbeat() -> bool:
    try:
        _client().heartbeat()
        return True
    except Exception:
        with _init_lock:
            _make_client.cache_clear()  # allow reconnecting once the server is up
        return False


def active_collection_name() -> str:
    s = get_settings()
    # One collection per embedding model, since vector dimensions differ between models.
    return re.sub(r"[^a-zA-Z0-9_-]", "_", f"docs_{s.embedding_provider}_{s.embedding_model}")[:60]


def _collection():
    with _init_lock:
        return _make_collection()


@lru_cache
def _make_collection():
    return _client().get_or_create_collection(
        active_collection_name(), embedding_function=None, metadata={"hnsw:space": "cosine"}
    )


def add_chunks(user_id: int, document_id: str, filename: str, chunks: list[str],
               start: int = 0) -> None:
    embeddings = get_embedding_provider().embed(chunks)
    idx = range(start, start + len(chunks))
    _collection().add(
        ids=[f"{document_id}:{i}" for i in idx],
        documents=chunks,
        embeddings=embeddings,
        metadatas=[
            {"user_id": user_id, "document_id": document_id, "filename": filename, "chunk": i}
            for i in idx
        ],
    )


def delete_document(document_id: str) -> None:
    _collection().delete(where={"document_id": document_id})


def search(user_id: int, query: str, k: int) -> list[dict]:
    [embedding] = get_embedding_provider().embed([query])
    res = _collection().query(
        query_embeddings=[embedding],
        n_results=k,
        where={"user_id": user_id},
        include=["documents", "metadatas", "distances"],
    )
    return [
        {"text": doc, "filename": meta["filename"], "document_id": meta["document_id"],
         "score": round(1 - dist, 4)}
        for doc, meta, dist in zip(res["documents"][0], res["metadatas"][0], res["distances"][0])
    ]


def collections_info(user_id: int) -> list[dict]:
    out = []
    for name in _client().list_collections():
        col = _client().get_collection(str(name))
        out.append({
            "name": col.name,
            "active": col.name == active_collection_name(),
            "total_chunks": col.count(),
            "your_chunks": len(col.get(where={"user_id": user_id}, include=[])["ids"]),
        })
    return out


def flush_user(user_id: int) -> int:
    """Delete all of a user's chunks in every collection; drop collections left empty."""
    removed = 0
    for name in _client().list_collections():
        col = _client().get_collection(str(name))
        ids = col.get(where={"user_id": user_id}, include=[])["ids"]
        if ids:
            col.delete(ids=ids)
            removed += len(ids)
        if col.count() == 0:
            _client().delete_collection(col.name)
    with _init_lock:
        _make_collection.cache_clear()
    return removed


def flush_all() -> int:
    """Drop every collection (all users). Returns number of chunks removed."""
    removed = 0
    for name in _client().list_collections():
        col = _client().get_collection(str(name))
        removed += col.count()
        _client().delete_collection(col.name)
    with _init_lock:
        _make_collection.cache_clear()
    return removed
