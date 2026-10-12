import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .config import get_settings
from .db import ApiKey, User, get_db

settings = get_settings()
bearer = HTTPBearer(auto_error=False)
API_KEY_PREFIX = "rag_"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_access_token(user_id: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    return jwt.encode({"sub": str(user_id), "exp": exp}, settings.jwt_secret, settings.jwt_algorithm)


def generate_api_key() -> tuple[str, str, str]:
    """Returns (plain_key, display_prefix, sha256_hash). Only the hash is persisted."""
    key = API_KEY_PREFIX + secrets.token_urlsafe(32)
    return key, key[:10], hash_api_key(key)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


_unauthorized = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid or missing credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    """Dashboard auth: JWT only."""
    if not creds:
        raise _unauthorized
    try:
        payload = jwt.decode(creds.credentials, settings.jwt_secret, [settings.jwt_algorithm])
        user = db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _unauthorized
    if not user:
        raise _unauthorized
    return user


def get_admin_user(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user


def get_api_key_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    """External API auth: `Authorization: Bearer rag_...` or `X-API-Key: rag_...`."""
    key = x_api_key or (creds.credentials if creds else None)
    if not key or not key.startswith(API_KEY_PREFIX):
        raise _unauthorized
    record = db.query(ApiKey).filter(ApiKey.key_hash == hash_api_key(key)).first()
    if not record:
        raise _unauthorized
    record.last_used_at = datetime.now(timezone.utc)
    db.commit()
    user = db.get(User, record.user_id)
    if not user:
        raise _unauthorized
    return user
