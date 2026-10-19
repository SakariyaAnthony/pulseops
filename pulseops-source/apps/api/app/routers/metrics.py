from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_timeseries
from app.stats import Window

router = APIRouter(tags=["metrics"])


@router.get("/projects/{project_id}/metrics/timeseries")
def timeseries(
    metric: str = "response_time",
    service: str | None = None,
    method: str | None = None,
    route: str | None = None,
    host: str | None = None,
    group_by: str | None = None,
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    if group_by not in {None, "service", "host"}:
        raise HTTPException(status_code=422, detail="group_by must be service or host")
    try:
        return build_timeseries(db, project, window, metric, service, method, route, host, group_by)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
