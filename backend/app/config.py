from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 720
    cors_origins: str = "http://localhost:3000"

    data_dir: Path = Path("./data")
    max_upload_mb: int = 25

    # "server" = separate Chroma process (started by run.sh); "embedded" = in-process
    chroma_mode: str = "server"
    chroma_host: str = "127.0.0.1"
    chroma_port: int = 8001

    # Embeddings: "local" (built-in ONNX all-MiniLM-L6-v2, no key) or "openai" (any OpenAI-compatible API)
    embedding_provider: str = "local"
    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_api_key: str = ""
    embedding_base_url: str = ""

    # Chat LLM: "groq" or "openai" (any OpenAI-compatible API)
    llm_provider: str = "groq"
    chat_model: str = "openai/gpt-oss-120b"
    llm_api_key: str = ""
    llm_base_url: str = ""

    chunk_size: int = 1000
    chunk_overlap: int = 200
    top_k: int = 5

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.jwt_secret == "change-me" or len(s.jwt_secret) < 32:
        raise RuntimeError("Set a strong JWT_SECRET (>= 32 chars) in backend/.env")
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
