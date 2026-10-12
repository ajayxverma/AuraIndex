from collections.abc import Iterator

from openai import OpenAI

from ..config import Settings
from .base import EmbeddingProvider, LLMProvider


class OpenAIEmbeddings(EmbeddingProvider):
    BATCH = 100

    def __init__(self, s: Settings):
        self.client = OpenAI(api_key=s.embedding_api_key or None,
                             base_url=s.embedding_base_url or None)
        self.model = s.embedding_model

    def embed(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.BATCH):
            resp = self.client.embeddings.create(model=self.model, input=texts[i : i + self.BATCH])
            out.extend(d.embedding for d in resp.data)
        return out


class OpenAILLM(LLMProvider):
    def __init__(self, s: Settings, default_base_url: str | None = None):
        self.client = OpenAI(api_key=s.llm_api_key or None,
                             base_url=s.llm_base_url or default_base_url)
        self.model_name = s.chat_model

    def chat(self, messages: list[dict], temperature: float = 0.2) -> str:
        resp = self.client.chat.completions.create(
            model=self.model_name, messages=messages, temperature=temperature
        )
        return resp.choices[0].message.content or ""

    def stream_chat(self, messages: list[dict], temperature: float = 0.2) -> Iterator[str]:
        stream = self.client.chat.completions.create(
            model=self.model_name, messages=messages, temperature=temperature, stream=True
        )
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content
