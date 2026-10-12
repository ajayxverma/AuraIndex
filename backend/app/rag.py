from .config import get_settings
from .vectorstore import search

SYSTEM_PROMPT = (
    "You are a helpful assistant. Answer the user's question using the provided context "
    "from their documents. If the context does not contain the answer, say so clearly. "
    "Cite source filenames in square brackets when relevant."
)


def build_messages(user_id: int, question: str, history: list[dict] | None = None,
                   top_k: int | None = None) -> tuple[list[dict], list[dict]]:
    sources = search(user_id, question, top_k or get_settings().top_k)
    context = "\n\n---\n\n".join(f"[{s['filename']}]\n{s['text']}" for s in sources)
    system = f"{SYSTEM_PROMPT}\n\nContext:\n{context or '(no relevant documents found)'}"
    messages = [{"role": "system", "content": system}]
    messages += [m for m in (history or []) if m.get("role") in ("user", "assistant")]
    messages.append({"role": "user", "content": question})
    return messages, sources
