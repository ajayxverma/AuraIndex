from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import jobs, vectorstore
from ..db import ApiKey, ChatMessage, Conversation, Document, User, get_db
from ..security import get_admin_user

router = APIRouter(prefix="/api/admin", tags=["admin"])
FLUSH_ALL_PHRASE = "FLUSH ALL"


class RoleIn(BaseModel):
    is_admin: bool


class ConfirmIn(BaseModel):
    confirm: str


def _admin_count(db: Session) -> int:
    return db.query(func.count(User.id)).filter(User.is_admin.is_(True)).scalar() or 0


@router.get("/users")
def list_users(_: User = Depends(get_admin_user), db: Session = Depends(get_db)):
    docs = dict(db.query(Document.user_id, func.count(Document.id)).group_by(Document.user_id).all())
    chunks = dict(db.query(Document.user_id, func.sum(Document.chunk_count))
                  .group_by(Document.user_id).all())
    keys = dict(db.query(ApiKey.user_id, func.count(ApiKey.id)).group_by(ApiKey.user_id).all())
    return [
        {"id": u.id, "email": u.email, "is_admin": u.is_admin, "created_at": u.created_at,
         "documents": docs.get(u.id, 0), "chunks": chunks.get(u.id) or 0,
         "api_keys": keys.get(u.id, 0)}
        for u in db.query(User).order_by(User.id).all()
    ]


@router.patch("/users/{user_id}")
def set_role(user_id: int, body: RoleIn, admin: User = Depends(get_admin_user),
             db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if not body.is_admin and user.is_admin and _admin_count(db) <= 1:
        raise HTTPException(400, "Cannot remove the last admin")
    user.is_admin = body.is_admin
    db.commit()
    return {"id": user.id, "email": user.email, "is_admin": user.is_admin}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(user_id: int, admin: User = Depends(get_admin_user),
                      db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(400, "You cannot delete your own account")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    await run_in_threadpool(jobs.cancel_all, user_id)
    await run_in_threadpool(vectorstore.flush_user, user_id)
    db.query(Document).filter(Document.user_id == user_id).delete()
    db.query(ApiKey).filter(ApiKey.user_id == user_id).delete()
    conv_ids = [c for (c,) in db.query(Conversation.id).filter(Conversation.user_id == user_id)]
    db.query(ChatMessage).filter(ChatMessage.conversation_id.in_(conv_ids)).delete()
    db.query(Conversation).filter(Conversation.user_id == user_id).delete()
    db.delete(user)
    db.commit()


@router.post("/flush-all")
async def flush_all(body: ConfirmIn, _: User = Depends(get_admin_user),
                    db: Session = Depends(get_db)):
    if body.confirm != FLUSH_ALL_PHRASE:
        raise HTTPException(400, f"Type {FLUSH_ALL_PHRASE} to confirm")
    await run_in_threadpool(jobs.cancel_all, None)
    removed_chunks = await run_in_threadpool(vectorstore.flush_all)
    removed_docs = db.query(Document).delete()
    db.commit()
    return {"removed_documents": removed_docs, "removed_chunks": removed_chunks}
