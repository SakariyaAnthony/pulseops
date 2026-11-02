from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_error_detail, build_errors
from app.stats import Window

router = APIRouter(tags=["errors"])


@router.get("/projects/{project_id}/errors")
def errors(
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    return build_errors(db, project, window)


@router.get("/projects/{project_id}/errors/{fingerprint}")
def error_detail(
    fingerprint: str,
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    body = build_error_detail(db, project, window, fingerprint)
    if body is None:
        raise HTTPException(status_code=404, detail="Error group not found")
    return body
