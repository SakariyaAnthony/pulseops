import re
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_owned_project
from app.models import ApiKey, Environment, Project, ScanRun, User
from app.routers.scans import apply_scan_config
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
    # One app, one project. A repeated name would only create a confusing "-2" copy, so refuse it.
    for existing in db.query(Project).filter(Project.owner_id == user.id).all():
        if existing.slug == base or _slugify(existing.name) == base:
            raise HTTPException(
                status_code=409,
                detail=f'A project named "{existing.name}" already exists. Use it, or delete it first.',
            )
    suffix = 2
    while db.query(Project).filter(Project.slug == slug).one_or_none() is not None:
        slug = f"{base}-{suffix}"
        suffix += 1
    project = Project(slug=slug, name=body.name.strip(), owner_id=user.id)
    if body.scan_config is not None:
        # Validate before anything is added, so a bad path creates no project.
        apply_scan_config(project, body.scan_config)
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


# Telemetry tables hold a project_id but no foreign key (they are Timescale hypertables), so they are cleared by hand.
TELEMETRY_TABLES = ("request_metrics", "resource_metrics", "error_events", "web_vitals", "page_loads")


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(
    project: Project = Depends(get_owned_project),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Permanently remove a project with its keys, environments, alerts, scans, assets and telemetry."""
    owned = db.query(Project).filter(Project.owner_id == user.id).count()
    if owned <= 1:
        raise HTTPException(status_code=409, detail="You need at least one project. Create another one before deleting this one.")
    active = (
        db.query(ScanRun)
        .filter(ScanRun.project_id == project.id, ScanRun.status.in_(("queued", "running")))
        .count()
    )
    if active:
        raise HTTPException(status_code=409, detail="A scan is still running for this project. Cancel it first, then delete the project.")

    params = {"project_id": project.id}
    for table in TELEMETRY_TABLES:
        db.execute(text(f"DELETE FROM {table} WHERE project_id = :project_id"), params)
    # The per-minute rollup is a continuous aggregate. Clear its stored rows so nothing is left behind.
    materialized = db.execute(
        text(
            "SELECT materialization_hypertable_schema, materialization_hypertable_name "
            "FROM timescaledb_information.continuous_aggregates WHERE view_name = 'request_metrics_1m'"
        )
    ).first()
    if materialized is not None:
        db.execute(
            text(f'DELETE FROM "{materialized[0]}"."{materialized[1]}" WHERE project_id = :project_id'),
            params,
        )
    db.delete(project)
    db.commit()
    return Response(status_code=204)


@router.post("/projects/{project_id}/api-key", status_code=201)
def rotate_api_key(project: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    """Replace the project's ingest key. The new token is returned once. Apps using the old key stop being accepted."""
    now = datetime.now(timezone.utc)
    for old in db.query(ApiKey).filter(ApiKey.project_id == project.id, ApiKey.revoked_at.is_(None)).all():
        old.revoked_at = now
    raw = "po_live_" + secrets.token_urlsafe(24)
    key = ApiKey(project_id=project.id, name="default", key_prefix=raw[:12], key_hash=hash_api_key(raw))
    db.add(key)
    db.commit()
    db.refresh(key)
    return {"api_key": {"id": str(key.id), "name": key.name, "prefix": key.key_prefix, "token": raw}}
