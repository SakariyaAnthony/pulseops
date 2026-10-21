import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_api_key
from app.models import ApiKey, Deploy
from app.queries import build_snapshot
from app.redis_bus import enforce_rate_limit, publish
from app.schemas import ErrorsIn, EventsIn, MetricsIn, VitalsIn
from app.vitals import rate

logger = logging.getLogger("pulseops.ingest")
router = APIRouter(prefix="/ingest/v1", tags=["ingest"])


def _when(value: datetime | None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        return current.replace(tzinfo=timezone.utc)
    return current


@router.post("/metrics", status_code=202)
def ingest_metrics(body: MetricsIn, api_key: ApiKey = Depends(get_api_key), db: Session = Depends(get_db)):
    enforce_rate_limit(api_key.id)
    if body.requests:
        db.execute(
            text(
                """
                INSERT INTO request_metrics (
                    time, project_id, env, service, host, method, route,
                    status_code, duration_ms, trace_id, version, weight
                ) VALUES (
                    :time, :project_id, :env, :service, :host, :method, :route,
                    :status_code, :duration_ms, :trace_id, :version, 1
                )
                """
            ),
            [
                {
                    "time": _when(point.time),
                    "project_id": api_key.project_id,
                    "env": point.env,
                    "service": point.service,
                    "host": point.host,
                    "method": point.method.upper(),
                    "route": point.route,
                    "status_code": point.status_code,
                    "duration_ms": point.duration_ms,
                    "trace_id": point.trace_id,
                    "version": point.version,
                }
                for point in body.requests
            ],
        )
    if body.resources:
        db.execute(
            text(
                """
                INSERT INTO resource_metrics (
                    time, project_id, env, service, host, cpu_pct, mem_rss_mb, heap_used_mb,
                    disk_read_bps, disk_write_bps, net_in_bps, net_out_bps,
                    event_loop_lag_ms, gc_pause_ms
                ) VALUES (
                    :time, :project_id, :env, :service, :host, :cpu_pct, :mem_rss_mb, :heap_used_mb,
                    :disk_read_bps, :disk_write_bps, :net_in_bps, :net_out_bps,
                    :event_loop_lag_ms, :gc_pause_ms
                )
                """
            ),
            [
                {
                    "time": _when(point.time),
                    "project_id": api_key.project_id,
                    **point.model_dump(exclude={"time"}),
                }
                for point in body.resources
            ],
        )
    accepted = len(body.requests) + len(body.resources)
    db.commit()
    if accepted:
        _publish_snapshot(db, api_key.project_id)
    return JSONResponse(status_code=202, content={"accepted": accepted})


@router.post("/errors", status_code=202)
def ingest_errors(body: ErrorsIn, api_key: ApiKey = Depends(get_api_key), db: Session = Depends(get_db)):
    enforce_rate_limit(api_key.id)
    if body.errors:
        db.execute(
            text(
                """
                INSERT INTO error_events (
                    time, project_id, env, service, fingerprint, type, message, stack, route, trace_id, context
                ) VALUES (
                    :time, :project_id, :env, :service, :fingerprint, :type, :message, :stack, :route, :trace_id,
                    CAST(:context AS jsonb)
                )
                """
            ),
            [
                {
                    "time": _when(point.time),
                    "project_id": api_key.project_id,
                    "env": point.env,
                    "service": point.service,
                    "fingerprint": point.fingerprint,
                    "type": point.type,
                    "message": point.message,
                    "stack": point.stack,
                    "route": point.route,
                    "trace_id": point.trace_id,
                    "context": json.dumps(point.context or {}),
                }
                for point in body.errors
            ],
        )
    db.commit()
    return JSONResponse(status_code=202, content={"accepted": len(body.errors)})


@router.post("/vitals", status_code=202)
def ingest_vitals(body: VitalsIn, api_key: ApiKey = Depends(get_api_key), db: Session = Depends(get_db)):
    """Field data: one row per metric per page view, plus one load record per page view."""
    enforce_rate_limit(api_key.id)
    if body.vitals:
        db.execute(
            text(
                """
                INSERT INTO web_vitals (
                    time, project_id, env, service, route, nav_type, device, metric, value, rating,
                    page_view_id, connection, version
                ) VALUES (
                    :time, :project_id, :env, :service, :route, :nav_type, :device, :metric, :value, :rating,
                    :page_view_id, :connection, :version
                )
                """
            ),
            [
                {
                    "time": _when(point.time),
                    "project_id": api_key.project_id,
                    **point.model_dump(exclude={"time"}),
                    # The rating is computed here so it always matches the thresholds the dashboard shows.
                    "rating": rate(point.metric, point.value),
                }
                for point in body.vitals
            ],
        )
    if body.loads:
        db.execute(
            text(
                """
                INSERT INTO page_loads (
                    time, project_id, env, service, route, nav_type, device, ttfb_ms, dom_content_loaded_ms,
                    load_ms, transfer_bytes, resource_count, js_bytes, long_task_count, long_task_ms, tbt_ms,
                    page_view_id, version
                ) VALUES (
                    :time, :project_id, :env, :service, :route, :nav_type, :device, :ttfb_ms,
                    :dom_content_loaded_ms, :load_ms, :transfer_bytes, :resource_count, :js_bytes,
                    :long_task_count, :long_task_ms, :tbt_ms, :page_view_id, :version
                )
                """
            ),
            [
                {"time": _when(point.time), "project_id": api_key.project_id, **point.model_dump(exclude={"time"})}
                for point in body.loads
            ],
        )
    db.commit()
    return JSONResponse(status_code=202, content={"accepted": len(body.vitals) + len(body.loads)})


@router.post("/events", status_code=202)
def ingest_events(body: EventsIn, api_key: ApiKey = Depends(get_api_key), db: Session = Depends(get_db)):
    enforce_rate_limit(api_key.id)
    for event in body.events:
        if event.type == "deploy":
            if not event.version:
                raise HTTPException(status_code=422, detail="deploy events require version")
            db.add(
                Deploy(
                    project_id=api_key.project_id,
                    env=event.env,
                    service=event.service,
                    version=event.version,
                    commit_sha=event.commit_sha,
                    deployed_at=_when(event.time),
                )
            )
    db.commit()
    return JSONResponse(status_code=202, content={"accepted": len(body.events)})


def _publish_snapshot(db: Session, project_id) -> None:
    try:
        publish(project_id, {"event": "metrics.snapshot", "data": build_snapshot(db, project_id)})
    except Exception:
        logger.warning("snapshot publish failed", exc_info=True)
