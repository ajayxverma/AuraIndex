from abc import ABC, abstractmethod
from collections.abc import Iterator


class EmbeddingProvider(ABC):
    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class LLMProvider(ABC):
    model_name: str

    @abstractmethod
    def chat(self, messages: list[dict], temperature: float = 0.2) -> str: ...

    @abstractmethod
    def stream_chat(self, messages: list[dict], temperature: float = 0.2) -> Iterator[str]: ...
