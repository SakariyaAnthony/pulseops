from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import require_admin
from app.models import Project, User
from app.schemas import UserUpdateIn
from app.serialize import user_out

router = APIRouter(prefix="/users", tags=["users"])


def _with_projects(db: Session, users: list[User]) -> list[dict]:
    counts = dict(
        db.query(Project.owner_id, func.count(Project.id))
        .filter(Project.owner_id.in_([user.id for user in users]))
        .group_by(Project.owner_id)
        .all()
    )
    return [{**user_out(user), "project_count": int(counts.get(user.id, 0))} for user in users]


@router.get("")
def list_users(
    search: str | None = Query(None, max_length=100),
    role: Literal["admin", "member"] | None = None,
    status: Literal["active", "disabled"] | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    _admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    query = db.query(User)
    if search and search.strip():
        like = f"%{search.strip().lower().replace('%', '').replace('_', '')}%"
        query = query.filter(or_(func.lower(User.email).like(like), func.lower(User.name).like(like)))
    if role:
        query = query.filter(User.role == role)
    if status:
        query = query.filter(User.is_active.is_(status == "active"))
    total = query.count()
    rows = query.order_by(User.created_at.desc(), User.email).offset(offset).limit(limit).all()
    return {
        "users": _with_projects(db, rows),
        "total": total,
        "totals": {
            "all": db.query(func.count(User.id)).scalar() or 0,
            "admins": db.query(func.count(User.id)).filter(User.role == "admin", User.is_active.is_(True)).scalar() or 0,
            "disabled": db.query(func.count(User.id)).filter(User.is_active.is_(False)).scalar() or 0,
        },
    }


@router.patch("/{user_id}")
def update_user(
    user_id: UUID,
    body: UserUpdateIn,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    losing_admin = (body.role == "member" and target.role == "admin") or (body.is_active is False and target.role == "admin")
    if target.id == admin.id and (body.role == "member" or body.is_active is False):
        raise HTTPException(status_code=409, detail="You cannot remove your own admin access or disable your own account")
    if losing_admin:
        others = (
            db.query(func.count(User.id))
            .filter(User.role == "admin", User.is_active.is_(True), User.id != target.id)
            .scalar()
        )
        if not others:
            raise HTTPException(status_code=409, detail="At least one active admin is required")
    if body.role is not None:
        target.role = body.role
    if body.is_active is not None:
        target.is_active = body.is_active
    db.commit()
    db.refresh(target)
    return _with_projects(db, [target])[0]
