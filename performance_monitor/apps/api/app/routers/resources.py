from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_resources
from app.stats import Window

router = APIRouter(tags=["resources"])


@router.get("/projects/{project_id}/resources")
def resources(
    host: str | None = None,
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    return build_resources(db, project, window, host)
