from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import authenticate, get_current_user
from app.models import Project, User
from app.redis_bus import enforce_window_limit, remember_refresh
from app.schemas import LoginIn, PasswordChangeIn, ProfileUpdateIn, RefreshIn, RegisterIn
from app.security import decode_token, hash_password, issue_token, verify_password
from app.serialize import user_out

router = APIRouter(prefix="/auth", tags=["auth"])

REGISTER_WINDOW_SECONDS = 3600


def _tokens(user: User) -> dict:
    return {
        "access_token": issue_token(user.id, "access", settings.access_ttl_seconds),
        "refresh_token": issue_token(user.id, "refresh", settings.refresh_ttl_seconds),
        "token_type": "bearer",
        "expires_in": settings.access_ttl_seconds,
        "user": user_out(user),
    }


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    """Open sign-up. A new account is a member with no projects. It is signed in straight away."""
    if not settings.allow_registration:
        raise HTTPException(status_code=403, detail="Sign-up is turned off on this server")
    enforce_window_limit("register", request.client.host if request.client else "unknown", settings.register_limit_per_hour, REGISTER_WINDOW_SECONDS)
    taken = db.query(User.id).filter(func.lower(User.email) == body.email).first()
    if taken is not None:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    user = User(
        email=body.email,
        name=body.name,
        password_hash=hash_password(body.password),
        role="member",
        last_login_at=datetime.now(timezone.utc),
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    db.refresh(user)
    return _tokens(user)


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    user = authenticate(db, body.email, body.password)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return _tokens(user)


def _profile(db: Session, user: User) -> dict:
    count = db.query(func.count(Project.id)).filter(Project.owner_id == user.id).scalar() or 0
    return {**user_out(user), "project_count": int(count)}


@router.get("/me")
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _profile(db, user)


@router.patch("/me")
def update_me(body: ProfileUpdateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.name = body.name
    db.commit()
    db.refresh(user)
    return _profile(db, user)


@router.post("/password")
def change_password(body: PasswordChangeIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=403, detail="The current password is not correct")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=422, detail="Choose a password you have not used just now")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    return {"changed": True}


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
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid token")
    return _tokens(user)
