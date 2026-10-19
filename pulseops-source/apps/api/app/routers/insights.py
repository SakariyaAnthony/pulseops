from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_insights
from app.stats import Window

router = APIRouter(tags=["insights"])


@router.get("/projects/{project_id}/insights")
def insights(
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    return build_insights(db, project, window)
