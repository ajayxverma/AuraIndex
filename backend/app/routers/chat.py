"""Dashboard chat with persistent conversations (JWT auth).

Sending a message streams NDJSON events: sources, token..., done | error.
"""
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import ChatMessage, Conversation, SessionLocal, User, get_db, utcnow
from ..providers import get_llm_provider
from ..rag import build_messages
from ..security import get_current_user

router = APIRouter(prefix="/api/chat", tags=["chat"])
HISTORY_TURNS = 10


class ConversationIn(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class RenameIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class MessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=20000)


def _conv_out(c: Conversation) -> dict:
    return {"id": c.id, "title": c.title, "created_at": c.created_at, "updated_at": c.updated_at}


def _msg_out(m: ChatMessage) -> dict:
    return {"id": m.id, "role": m.role, "content": m.content, "error": m.error,
            "sources": json.loads(m.sources_json) if m.sources_json else None,
            "created_at": m.created_at}


def _get_owned(db: Session, user: User, conv_id: str) -> Conversation:
    conv = db.query(Conversation).filter(Conversation.id == conv_id,
                                         Conversation.user_id == user.id).first()
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv


@router.get("/conversations")
def list_conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    convs = (db.query(Conversation).filter(Conversation.user_id == user.id)
             .order_by(Conversation.updated_at.desc()).all())
    return [_conv_out(c) for c in convs]


@router.post("/conversations", status_code=201)
def create_conversation(body: ConversationIn, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    conv = Conversation(id=str(uuid.uuid4()), user_id=user.id, title=body.title or "New chat")
    db.add(conv)
    db.commit()
    return _conv_out(conv)


@router.get("/conversations/{conv_id}")
def get_conversation(conv_id: str, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    conv = _get_owned(db, user, conv_id)
    msgs = (db.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id)
            .order_by(ChatMessage.id).all())
    return {**_conv_out(conv), "messages": [_msg_out(m) for m in msgs]}


@router.patch("/conversations/{conv_id}")
def rename_conversation(conv_id: str, body: RenameIn, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    conv = _get_owned(db, user, conv_id)
    conv.title = body.title.strip()
    db.commit()
    return _conv_out(conv)


@router.delete("/conversations/{conv_id}", status_code=204)
def delete_conversation(conv_id: str, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    conv = _get_owned(db, user, conv_id)
    db.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id).delete()
    db.delete(conv)
    db.commit()


@router.delete("/conversations", status_code=204)
def delete_all_conversations(user: User = Depends(get_current_user),
                             db: Session = Depends(get_db)):
    ids = [c for (c,) in db.query(Conversation.id).filter(Conversation.user_id == user.id)]
    db.query(ChatMessage).filter(ChatMessage.conversation_id.in_(ids)).delete()
    db.query(Conversation).filter(Conversation.user_id == user.id).delete()
    db.commit()


@router.post("/conversations/{conv_id}/messages")
async def send_message(conv_id: str, body: MessageIn, user: User = Depends(get_current_user),
                       db: Session = Depends(get_db)):
    conv = _get_owned(db, user, conv_id)
    prior = (db.query(ChatMessage).filter(ChatMessage.conversation_id == conv.id,
                                          ChatMessage.error.is_(None))
             .order_by(ChatMessage.id.desc()).limit(HISTORY_TURNS * 2).all())
    history = [{"role": m.role, "content": m.content} for m in reversed(prior)]

    question = body.content.strip()
    if not prior and conv.title == "New chat":
        conv.title = question[:60] + ("..." if len(question) > 60 else "")
    db.add(ChatMessage(conversation_id=conv.id, role="user", content=question))
    conv.updated_at = utcnow()
    db.commit()

    messages, sources = await run_in_threadpool(build_messages, user.id, question, history)

    def events():
        answer, error = [], None
        try:
            yield json.dumps({"type": "sources", "sources": sources}) + "\n"
            for token in get_llm_provider().stream_chat(messages):
                answer.append(token)
                yield json.dumps({"type": "token", "content": token}) + "\n"
            yield json.dumps({"type": "done"}) + "\n"
        except Exception as e:  # surface provider errors (rate limits, bad key) to the UI
            error = str(e)[:500]
            yield json.dumps({"type": "error", "message": error}) + "\n"
        finally:
            # Runs on Stop (client disconnect) too, so partial answers are kept.
            with SessionLocal() as s:
                c = s.get(Conversation, conv_id)
                if c:  # may have been deleted while streaming
                    s.add(ChatMessage(conversation_id=conv_id, role="assistant",
                                      content="".join(answer), error=error,
                                      sources_json=json.dumps(sources)))
                    c.updated_at = utcnow()
                    s.commit()

    return StreamingResponse(events(), media_type="application/x-ndjson")
