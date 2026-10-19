from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_overview
from app.stats import Window

router = APIRouter(tags=["overview"])


@router.get("/projects/{project_id}/overview")
def overview(
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    return build_overview(db, project, window)
