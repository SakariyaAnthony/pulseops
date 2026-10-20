from __future__ import annotations

from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import fetch_project, get_current_user
from app.models import ApiObservation, PageResult, Project, ScanAsset, ScanRun, User
from app.scan.paths import clean_base_url, clean_routes, resolve_repository
from app.scan.static import detect_framework
from app.scan.report import summarize
from app.scan.stats import median, percentile
from app.scan.worker import enqueue
from app.schemas import ScanConfigIn, ScanCreateIn
from app.serialize import iso

router = APIRouter(tags=["scans"])


def _owned_scan(db: Session, user: User, scan_id: str) -> ScanRun:
    try:
        parsed = UUID(scan_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Scan not found") from exc
    scan = db.get(ScanRun, parsed)
    if scan is None:
        raise HTTPException(status_code=404, detail="Scan not found")
    project = db.get(Project, scan.project_id)
    if project is None or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Scan not found")
    return scan


def scan_out(scan: ScanRun) -> dict:
    return {
        "id": str(scan.id),
        "project_id": str(scan.project_id),
        "status": scan.status,
        "mode": scan.mode,
        "progress": scan.progress or {},
        "config": scan.config_json or {},
        "error_summary": scan.error_summary,
        "started_at": iso(scan.started_at),
        "completed_at": iso(scan.completed_at),
        "created_at": iso(scan.created_at),
    }


def _bind_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Project:
    return fetch_project(db, user, project_id)


@router.patch("/projects/{project_id}/scan-config")
def update_scan_config(
    body: ScanConfigIn,
    project: Project = Depends(_bind_project),
    db: Session = Depends(get_db),
):
    repository = resolve_repository(body.repository_path) if body.repository_path else None
    base_url = clean_base_url(body.base_url)
    routes = clean_routes(body.routes)
    project.repository_path = str(repository) if repository else None
    project.base_url = base_url
    project.framework = detect_framework(repository) if repository else project.framework
    project.scan_config = {
        "routes": routes,
        "viewport": {"width": body.viewport.width, "height": body.viewport.height},
        "timeout_ms": body.timeout_ms,
        "start_command": body.start_command.strip() if body.start_command else None,
    }
    db.commit()
    db.refresh(project)
    from app.serialize import project_out

    return project_out(db, project)


@router.post("/projects/{project_id}/scans", status_code=201)
def create_scan(
    body: ScanCreateIn,
    project: Project = Depends(_bind_project),
    db: Session = Depends(get_db),
):
    config = dict(project.scan_config or {})
    if body.mode in {"static", "full"} and not project.repository_path:
        raise HTTPException(status_code=422, detail="Add a repository path before a static scan")
    if body.mode in {"browser", "full"} and not project.base_url:
        raise HTTPException(status_code=422, detail="Add a localhost base URL before a browser scan")
    snapshot = {
        "project_id": str(project.id),
        "repository_path": project.repository_path,
        "base_url": project.base_url,
        "framework": project.framework,
        "routes": config.get("routes") or ["/"],
        "viewport": config.get("viewport") or {"width": 1280, "height": 720},
        "timeout_ms": config.get("timeout_ms") or 15000,
        "start_command": config.get("start_command"),
    }
    scan = ScanRun(project_id=project.id, status="queued", mode=body.mode, progress={}, config_json=snapshot)
    db.add(scan)
    db.commit()
    db.refresh(scan)
    enqueue(str(scan.id))
    db.refresh(scan)
    return scan_out(scan)


@router.get("/projects/{project_id}/scans")
def list_scans(project: Project = Depends(_bind_project), db: Session = Depends(get_db)):
    rows = (
        db.query(ScanRun)
        .filter(ScanRun.project_id == project.id)
        .order_by(ScanRun.created_at.desc())
        .limit(50)
        .all()
    )
    return {"scans": [scan_out(row) for row in rows]}


@router.get("/scans/{scan_id}")
def get_scan(scan_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return scan_out(_owned_scan(db, user, scan_id))


@router.post("/scans/{scan_id}/cancel")
def cancel_scan(scan_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    scan = _owned_scan(db, user, scan_id)
    if scan.status in {"completed", "failed", "partial", "cancelled"}:
        return scan_out(scan)
    scan.status = "cancelled"
    scan.error_summary = "Cancelled"
    db.commit()
    db.refresh(scan)
    return scan_out(scan)


@router.get("/scans/{scan_id}/assets")
def scan_assets(
    scan_id: str,
    classification: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    scan = _owned_scan(db, user, scan_id)
    query = db.query(ScanAsset).filter(ScanAsset.scan_id == scan.id)
    if classification:
        query = query.filter(ScanAsset.classification == classification)
    rows = query.order_by(ScanAsset.file_path).all()
    assets = [_asset_out(row) for row in rows]
    return {
        "total": len(assets),
        "summary": summarize(assets),
        "assets": assets[offset : offset + limit],
    }


def _asset_out(row: ScanAsset) -> dict:
    return {
        "id": str(row.id),
        "file_path": row.file_path,
        "classification": row.classification,
        "explanation": row.explanation,
        "confidence": row.confidence,
        "duplicate_of": row.duplicate_of,
        "references": list(row.references_json or []),
        "routes": list(row.routes_json or []),
        "transfer_bytes": row.transfer_bytes,
        "duration_ms": row.duration_ms,
        "failure_type": row.failure_type,
        "signals": row.signals_json or {},
        "asset_type": row.asset.asset_type if row.asset is not None else (row.signals_json or {}).get("asset_type"),
        "file_size_bytes": row.asset.file_size_bytes if row.asset is not None else None,
        "content_hash": row.asset.content_hash if row.asset is not None else None,
    }


@router.get("/scans/{scan_id}/apis")
def scan_apis(scan_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    scan = _owned_scan(db, user, scan_id)
    rows = (
        db.query(ApiObservation)
        .filter(ApiObservation.scan_id == scan.id)
        .order_by(ApiObservation.observed_at)
        .all()
    )
    grouped: dict[tuple[str, str], list[ApiObservation]] = defaultdict(list)
    for row in rows:
        grouped[(row.method, row.endpoint_template)].append(row)
    endpoints = []
    for (method, template), items in sorted(grouped.items()):
        durations = [item.duration_ms for item in items if item.duration_ms is not None]
        failures = [item for item in items if item.failure_type or (item.status_code is not None and item.status_code >= 400)]
        endpoints.append(
            {
                "method": method,
                "endpoint_template": template,
                "count": len(items),
                "sample_count": len(durations),
                "error_rate": len(failures) / len(items) if items else None,
                "median_ms": median(durations),
                "p95_ms": percentile(durations, 95),
                "p99_ms": percentile(durations, 99),
            }
        )
    return {
        "endpoints": endpoints,
        "requests": [
            {
                "route": row.route,
                "method": row.method,
                "endpoint_template": row.endpoint_template,
                "status_code": row.status_code,
                "duration_ms": row.duration_ms,
                "transfer_bytes": row.transfer_bytes,
                "failure_type": row.failure_type,
            }
            for row in rows[:200]
        ],
    }


@router.get("/scans/{scan_id}/pages")
def scan_pages(scan_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    scan = _owned_scan(db, user, scan_id)
    rows = db.query(PageResult).filter(PageResult.scan_id == scan.id).order_by(PageResult.route).all()
    return {
        "pages": [
            {
                "route": row.route,
                "viewport": row.viewport_json,
                "metric_source": row.metric_source,
                "lcp_ms": row.lcp_ms,
                "inp_ms": row.inp_ms,
                "cls": row.cls,
                "total_transfer_bytes": row.total_transfer_bytes,
                "duration_ms": row.duration_ms,
                "sample_count": row.sample_count,
                "status": row.status,
                "error_summary": row.error_summary,
            }
            for row in rows
        ]
    }
