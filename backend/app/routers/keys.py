from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import ApiKey, User, get_db
from ..security import generate_api_key, get_current_user

router = APIRouter(prefix="/api/keys", tags=["api-keys"])


class KeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class KeyOut(BaseModel):
    id: int
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None

    model_config = {"from_attributes": True}


class KeyCreated(KeyOut):
    key: str  # returned only once


@router.get("", response_model=list[KeyOut])
def list_keys(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return (db.query(ApiKey).filter(ApiKey.user_id == user.id)
            .order_by(ApiKey.created_at.desc()).all())


@router.post("", response_model=KeyCreated, status_code=201)
def create_key(body: KeyCreate, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    plain, prefix, hashed = generate_api_key()
    record = ApiKey(user_id=user.id, name=body.name, prefix=prefix, key_hash=hashed)
    db.add(record)
    db.commit()
    return KeyCreated(**KeyOut.model_validate(record).model_dump(), key=plain)


@router.delete("/{key_id}", status_code=204)
def revoke_key(key_id: int, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    record = db.query(ApiKey).filter(ApiKey.id == key_id, ApiKey.user_id == user.id).first()
    if not record:
        raise HTTPException(404, "Key not found")
    db.delete(record)
    db.commit()
