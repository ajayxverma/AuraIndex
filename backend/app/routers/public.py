"""Public endpoints authenticated with a generated API key."""
import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..db import User
from ..providers import get_llm_provider
from ..rag import build_messages
from ..security import get_api_key_user

router = APIRouter(tags=["public-api"])
MODEL_ID = "rag-knowledge-base"


class QueryIn(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    top_k: int | None = Field(default=None, ge=1, le=20)


@router.post("/api/query")
async def query(body: QueryIn, user: User = Depends(get_api_key_user)):
    messages, sources = await run_in_threadpool(build_messages, user.id, body.question,
                                                None, body.top_k)
    answer = await run_in_threadpool(get_llm_provider().chat, messages)
    return {"answer": answer, "sources": sources}


# ---- OpenAI-compatible API (for Copilot / Continue / LangChain / any OpenAI SDK) ----

class ChatMessage(BaseModel):
    role: str
    content: str | list | None = None


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float = 0.2


def _text(content) -> str:
    if isinstance(content, list):  # OpenAI content parts
        return " ".join(p.get("text", "") for p in content if isinstance(p, dict))
    return content or ""


@router.get("/v1/models")
def models(_: User = Depends(get_api_key_user)):
    return {"object": "list",
            "data": [{"id": MODEL_ID, "object": "model", "created": 0, "owned_by": "rag"}]}


@router.post("/v1/chat/completions")
async def chat_completions(body: ChatRequest, user: User = Depends(get_api_key_user)):
    msgs = [{"role": m.role, "content": _text(m.content)} for m in body.messages]
    user_msgs = [m for m in msgs if m["role"] == "user"]
    if not user_msgs:
        raise HTTPException(400, "At least one user message is required")
    question = user_msgs[-1]["content"]
    history = msgs[: len(msgs) - 1 - msgs[::-1].index(user_msgs[-1])]
    messages, _ = await run_in_threadpool(build_messages, user.id, question, history)
    llm = get_llm_provider()
    cid, created = f"chatcmpl-{uuid.uuid4().hex}", int(time.time())

    if not body.stream:
        answer = await run_in_threadpool(llm.chat, messages, body.temperature)
        return {
            "id": cid, "object": "chat.completion", "created": created, "model": MODEL_ID,
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": answer}}],
        }

    def event_stream():
        def chunk(delta: dict, finish: str | None = None) -> str:
            payload = {"id": cid, "object": "chat.completion.chunk", "created": created,
                       "model": MODEL_ID,
                       "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
            return f"data: {json.dumps(payload)}\n\n"

        yield chunk({"role": "assistant"})
        for token in llm.stream_chat(messages, body.temperature):
            yield chunk({"content": token})
        yield chunk({}, "stop")
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
