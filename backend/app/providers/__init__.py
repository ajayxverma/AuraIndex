"""Pluggable AI providers. Add a new provider by implementing the base classes
and registering it in the factories below; select it via EMBEDDING_PROVIDER / LLM_PROVIDER."""
from functools import lru_cache

from ..config import get_settings
from .base import EmbeddingProvider, LLMProvider

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    s = get_settings()
    if s.embedding_provider == "local":
        from .local_provider import LocalEmbeddings

        return LocalEmbeddings()
    if s.embedding_provider == "openai":
        from .openai_provider import OpenAIEmbeddings

        return OpenAIEmbeddings(s)
    raise ValueError(f"Unknown EMBEDDING_PROVIDER: {s.embedding_provider}")


@lru_cache
def get_llm_provider() -> LLMProvider:
    s = get_settings()
    if s.llm_provider in ("openai", "groq"):
        from .openai_provider import OpenAILLM

        default_url = GROQ_BASE_URL if s.llm_provider == "groq" else None
        return OpenAILLM(s, default_url)
    raise ValueError(f"Unknown LLM_PROVIDER: {s.llm_provider}")


__all__ = ["EmbeddingProvider", "LLMProvider", "get_embedding_provider", "get_llm_provider"]
