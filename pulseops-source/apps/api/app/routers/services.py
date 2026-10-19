from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_service_detail, build_services
from app.stats import Window

router = APIRouter(tags=["services"])


@router.get("/projects/{project_id}/services")
def services(
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    return build_services(db, project, window)


@router.get("/projects/{project_id}/services/{service}")
def service_detail(
    service: str,
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    body = build_service_detail(db, project, window, service)
    if body["calls"] == 0:
        raise HTTPException(status_code=404, detail="Service not found")
    return body
