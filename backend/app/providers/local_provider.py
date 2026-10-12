from chromadb.utils.embedding_functions import DefaultEmbeddingFunction

from .base import EmbeddingProvider


class LocalEmbeddings(EmbeddingProvider):
    """Offline all-MiniLM-L6-v2 (ONNX) bundled with ChromaDB; model downloads once (~80 MB)."""

    def __init__(self):
        self.fn = DefaultEmbeddingFunction()

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [list(map(float, v)) for v in self.fn(texts)]
