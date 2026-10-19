from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ApiKey, Project, User
from app.security import DUMMY_PASSWORD_HASH, decode_token, hash_api_key, verify_password
from app.stats import Window, WindowError, make_window


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = decode_token(token, "access")
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def fetch_project(db: Session, user: User, ref: str) -> Project:
    base = db.query(Project).filter(Project.owner_id == user.id)
    try:
        as_uuid = UUID(ref)
    except ValueError:
        as_uuid = None
    if as_uuid is not None:
        project = base.filter(Project.id == as_uuid).one_or_none()
        if project is not None:
            return project
    project = base.filter(Project.slug == ref).one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def get_owned_project(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    return fetch_project(db, user, project_id)


def get_window(
    range_key: str = Query("1h", alias="range"),
    env: str | None = None,
    environment: str | None = None,
    resolution: str | None = None,
    start: int | None = Query(None, alias="from"),
    end: int | None = Query(None, alias="to"),
) -> Window:
    try:
        return make_window(range_key, env or environment, resolution, start, end)
    except WindowError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def get_api_key(
    x_api_key: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> ApiKey:
    if not x_api_key or not x_api_key.strip():
        raise HTTPException(status_code=401, detail="Missing API key")
    row = (
        db.query(ApiKey)
        .filter(ApiKey.key_hash == hash_api_key(x_api_key.strip()), ApiKey.revoked_at.is_(None))
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return row


def authenticate(db: Session, email: str, password: str) -> User:
    user = db.query(User).filter(User.email == email.strip().lower()).one_or_none()
    if user is None or not verify_password(password, user.password_hash):
        verify_password(password, DUMMY_PASSWORD_HASH)
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return user
