from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.queries import build_endpoint_detail, build_endpoints, parse_endpoint_key
from app.stats import Window

router = APIRouter(tags=["endpoints"])
SORTS = {"p95", "avg", "calls", "error_pct", "apdex", "route"}


@router.get("/projects/{project_id}/endpoints")
def endpoints(
    service: str | None = None,
    method: str | None = None,
    q: str | None = None,
    sort: str = "p95",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    if sort not in SORTS:
        raise HTTPException(status_code=422, detail="invalid sort")
    return build_endpoints(
        db,
        project,
        window,
        service=service,
        method=method,
        q=q,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/projects/{project_id}/endpoints/{key:path}")
def endpoint_detail(
    key: str,
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    try:
        parse_endpoint_key(key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    body = build_endpoint_detail(db, project, window, key)
    if body is None:
        raise HTTPException(status_code=404, detail="Endpoint not found")
    return body
