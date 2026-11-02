from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.constants import VITALS_MIN_SAMPLES
from app.db import get_db
from app.deps import get_owned_project, get_window
from app.models import Project
from app.stats import Window
from app.vitals import build_lab, build_route_detail, build_routes, build_summary

router = APIRouter(tags=["vitals"])

Device = Literal["mobile", "tablet", "desktop"]
NavType = Literal["first_load", "spa_navigation"]


@router.get("/projects/{project_id}/vitals/summary")
def vitals_summary(
    device: Device | None = None,
    nav_type: NavType | None = None,
    min_samples: int = Query(VITALS_MIN_SAMPLES, ge=1, le=10000),
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    """Field data only: 75th percentiles from real page views."""
    return build_summary(db, project, window, device, nav_type, min_samples)


@router.get("/projects/{project_id}/vitals/routes")
def vitals_routes(
    device: Device | None = None,
    nav_type: NavType | None = None,
    min_samples: int = Query(VITALS_MIN_SAMPLES, ge=1, le=10000),
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    return build_routes(db, project, window, device, nav_type, min_samples)


@router.get("/projects/{project_id}/vitals/detail")
def vitals_detail(
    route: str = Query(min_length=1, max_length=300),
    device: Device | None = None,
    nav_type: NavType | None = None,
    min_samples: int = Query(VITALS_MIN_SAMPLES, ge=1, le=10000),
    project: Project = Depends(get_owned_project),
    window: Window = Depends(get_window),
    db: Session = Depends(get_db),
):
    """One route. The `field` and `lab` objects stay separate so callers never blend the two sources."""
    return build_route_detail(db, project, window, route, device, nav_type, min_samples)


@router.get("/projects/{project_id}/vitals/lab")
def vitals_lab(project: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    """Latest completed Lighthouse audit, every route and form factor."""
    return build_lab(db, project)
