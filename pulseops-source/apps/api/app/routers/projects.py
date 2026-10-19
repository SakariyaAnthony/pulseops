import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_owned_project
from app.models import ApiKey, Environment, Project, User
from app.schemas import ProjectCreate
from app.security import hash_api_key
from app.serialize import project_out

router = APIRouter(tags=["projects"])


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return (slug or "project")[:80]


@router.get("/projects")
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    projects = (
        db.query(Project).filter(Project.owner_id == user.id).order_by(Project.created_at).all()
    )
    return {"projects": [project_out(db, project) for project in projects]}


@router.post("/projects", status_code=201)
def create_project(body: ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    slug = (body.slug or _slugify(body.name)).lower()
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        raise HTTPException(status_code=422, detail="slug must be lowercase letters, numbers, and hyphens")
    base = slug
    suffix = 2
    while db.query(Project).filter(Project.slug == slug).one_or_none() is not None:
        slug = f"{base}-{suffix}"
        suffix += 1
    project = Project(slug=slug, name=body.name.strip(), owner_id=user.id)
    db.add(project)
    db.flush()
    for name in ("prod", "staging"):
        db.add(Environment(project_id=project.id, name=name))
    raw = "po_live_" + secrets.token_urlsafe(24)
    api_key = ApiKey(
        project_id=project.id,
        name="default",
        key_prefix=raw[:12],
        key_hash=hash_api_key(raw),
    )
    db.add(api_key)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Project slug already exists")
    db.refresh(project)
    db.refresh(api_key)
    return JSONResponse(
        status_code=201,
        content={
            "project": project_out(db, project),
            "api_key": {
                "id": str(api_key.id),
                "name": api_key.name,
                "prefix": api_key.key_prefix,
                "token": raw,
            },
        },
    )


@router.get("/projects/{project_id}")
def get_project(project: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    return project_out(db, project)
