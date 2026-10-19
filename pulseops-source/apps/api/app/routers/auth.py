from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import authenticate
from app.models import User
from app.redis_bus import remember_refresh
from app.schemas import LoginIn, RefreshIn
from app.security import decode_token, issue_token
from app.serialize import user_out

router = APIRouter(prefix="/auth", tags=["auth"])


def _tokens(user: User) -> dict:
    return {
        "access_token": issue_token(user.id, "access", settings.access_ttl_seconds),
        "refresh_token": issue_token(user.id, "refresh", settings.refresh_ttl_seconds),
        "token_type": "bearer",
        "expires_in": settings.access_ttl_seconds,
        "user": user_out(user),
    }


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(db, body.email, body.password)
    return _tokens(user)


@router.post("/refresh")
def refresh(body: RefreshIn, db: Session = Depends(get_db)):
    try:
        payload = decode_token(body.refresh_token, "refresh")
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid token")
    if not remember_refresh(payload.get("jti", ""), settings.refresh_ttl_seconds):
        raise HTTPException(status_code=401, detail="Refresh token already used")
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Invalid token")
    return _tokens(user)
