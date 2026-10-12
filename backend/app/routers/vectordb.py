from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import jobs, vectorstore
from ..config import get_settings
from ..db import Document, User, get_db
from ..security import get_current_user

router = APIRouter(prefix="/api/vectordb", tags=["vector-db"])
CONFIRM_PHRASE = "FLUSH"


class FlushIn(BaseModel):
    confirm: str


@router.get("")
async def info(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    s = get_settings()
    collections = await run_in_threadpool(vectorstore.collections_info, user.id)
    docs, chunks = (db.query(func.count(Document.id), func.sum(Document.chunk_count))
                    .filter(Document.user_id == user.id).one())
    active_chunks = next((c["your_chunks"] for c in collections if c["active"]), 0)
    return {
        "engine": "ChromaDB (persistent)",
        "embedding_provider": s.embedding_provider,
        "embedding_model": s.embedding_model,
        "active_collection": vectorstore.active_collection_name(),
        "your_documents": docs,
        "your_chunks_expected": chunks or 0,
        "your_chunks_indexed": active_chunks,
        "collections": collections,
    }


@router.post("/flush")
async def flush(body: FlushIn, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    if body.confirm != CONFIRM_PHRASE:
        raise HTTPException(400, f"Type {CONFIRM_PHRASE} to confirm")
    await run_in_threadpool(jobs.cancel_all, user.id)
    removed_chunks = await run_in_threadpool(vectorstore.flush_user, user.id)
    removed_docs = db.query(Document).filter(Document.user_id == user.id).delete()
    db.commit()
    return {"removed_documents": removed_docs, "removed_chunks": removed_chunks}
