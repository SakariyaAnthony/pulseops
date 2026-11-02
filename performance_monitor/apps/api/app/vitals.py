"""Field web vitals: rating and the queries behind the Web Vitals page.

Field data comes from real page views reported by the browser SDK. Lab data (Lighthouse) is stored
separately in page_results and is never mixed into these numbers.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.constants import CORE_VITALS, VITAL_THRESHOLDS, VITALS_MIN_SAMPLES
from app.models import PageResult, Project, ScanRun
from app.serialize import iso
from app.stats import INTERVALS, Window

RATING_ORDER = {"good": 0, "needs-improvement": 1, "poor": 2}
UNITS = {"LCP": "ms", "INP": "ms", "CLS": "", "FCP": "ms", "TTFB": "ms"}


def rate(metric: str, value: float | None) -> str | None:
    if value is None or metric not in VITAL_THRESHOLDS:
        return None
    good, poor = VITAL_THRESHOLDS[metric]
    if value <= good:
        return "good"
    if value <= poor:
        return "needs-improvement"
    return "poor"


def worst(ratings: list[str | None]) -> str | None:
    known = [item for item in ratings if item]
    if not known:
        return None
    return max(known, key=lambda item: RATING_ORDER[item])


def _round(value: float | None, metric: str) -> float | None:
    if value is None:
        return None
    return round(float(value), 4 if metric == "CLS" else 1)


def _filters(window: Window, device: str | None, nav_type: str | None, prefix: str = "") -> tuple[str, dict]:
    sql = f" AND {prefix}time >= :start AND {prefix}time < :end"
    params: dict = {"start": window.start, "end": window.end}
    if window.env:
        sql += f" AND {prefix}env = :env"
        params["env"] = window.env
    if device:
        sql += f" AND {prefix}device = :device"
        params["device"] = device
    if nav_type:
        sql += f" AND {prefix}nav_type = :nav_type"
        params["nav_type"] = nav_type
    return sql, params


def _p75(metric: str, n: int, value: float | None, min_samples: int) -> float | None:
    """A 75th percentile of a handful of page views is noise, so it is withheld below the sample floor."""
    if value is None or n < min_samples:
        return None
    return _round(value, metric)


def build_summary(
    db: Session,
    project: Project,
    window: Window,
    device: str | None = None,
    nav_type: str | None = None,
    min_samples: int = VITALS_MIN_SAMPLES,
) -> dict:
    where, params = _filters(window, device, nav_type)
    params["project_id"] = project.id
    rows = db.execute(
        text(
            f"""
            SELECT metric, count(*) AS n,
                   percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75,
                   count(*) FILTER (WHERE rating = 'good') AS good,
                   count(*) FILTER (WHERE rating = 'needs-improvement') AS improve,
                   count(*) FILTER (WHERE rating = 'poor') AS poor
            FROM web_vitals
            WHERE project_id = :project_id {where}
            GROUP BY metric
            """
        ),
        params,
    ).all()
    by_metric = {row.metric: row for row in rows}
    metrics = []
    for metric in (*CORE_VITALS, "FCP", "TTFB"):
        good_max, poor_min = VITAL_THRESHOLDS[metric]
        row = by_metric.get(metric)
        n = int(row.n) if row else 0
        p75 = _p75(metric, n, row.p75 if row else None, min_samples)
        metrics.append(
            {
                "metric": metric,
                "unit": UNITS[metric],
                "good_max": good_max,
                "poor_min": poor_min,
                "samples": n,
                "p75": p75,
                "rating": rate(metric, p75),
                "good_pct": round(100 * row.good / n, 1) if n else None,
                "improve_pct": round(100 * row.improve / n, 1) if n else None,
                "poor_pct": round(100 * row.poor / n, 1) if n else None,
            }
        )
    loads = db.execute(
        text(
            f"""
            SELECT count(*) AS views,
                   count(*) FILTER (WHERE nav_type = 'first_load') AS first_loads,
                   count(*) FILTER (WHERE device = 'mobile') AS mobile,
                   count(*) FILTER (WHERE device = 'desktop') AS desktop,
                   count(*) FILTER (WHERE device = 'tablet') AS tablet
            FROM page_loads
            WHERE project_id = :project_id {where}
            """
        ),
        params,
    ).one()
    return {
        "metrics": metrics,
        "page_views": int(loads.views),
        "first_loads": int(loads.first_loads),
        "devices": {"mobile": int(loads.mobile), "desktop": int(loads.desktop), "tablet": int(loads.tablet)},
        "min_samples": min_samples,
        "filters": {"device": device, "nav_type": nav_type},
    }


def _group_p75(db: Session, project_id, window: Window, group: str | None, device, nav_type) -> dict:
    where, params = _filters(window, device, nav_type)
    params["project_id"] = project_id
    select = f"route, {group}," if group else "route,"
    group_by = f"route, {group}, metric" if group else "route, metric"
    rows = db.execute(
        text(
            f"""
            SELECT {select} metric, count(*) AS n,
                   percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
            FROM web_vitals
            WHERE project_id = :project_id {where}
            GROUP BY {group_by}
            """
        ),
        params,
    ).all()
    out: dict = {}
    for row in rows:
        key = (row.route, getattr(row, group) if group else None)
        out.setdefault(key, {})[row.metric] = (int(row.n), float(row.p75) if row.p75 is not None else None)
    return out


def _cell(metric: str, entry: tuple[int, float | None] | None, min_samples: int) -> dict:
    if entry is None:
        return {"samples": 0, "p75": None, "rating": None}
    n, value = entry
    p75 = _p75(metric, n, value, min_samples)
    return {"samples": n, "p75": p75, "rating": rate(metric, p75)}


def build_routes(
    db: Session,
    project: Project,
    window: Window,
    device: str | None = None,
    nav_type: str | None = None,
    min_samples: int = VITALS_MIN_SAMPLES,
) -> dict:
    overall = _group_p75(db, project.id, window, None, device, nav_type)
    by_nav = _group_p75(db, project.id, window, "nav_type", device, None) if not nav_type else {}
    by_device = _group_p75(db, project.id, window, "device", None, nav_type) if not device else {}
    routes = sorted({key[0] for key in overall})
    items = []
    for route in routes:
        data = overall.get((route, None), {})
        cells = {metric: _cell(metric, data.get(metric), min_samples) for metric in (*CORE_VITALS, "FCP", "TTFB")}
        splits: dict = {}
        for name in ("first_load", "spa_navigation"):
            entry = by_nav.get((route, name))
            if entry:
                splits[name] = {metric: _cell(metric, entry.get(metric), min_samples) for metric in CORE_VITALS}
        for name in ("mobile", "tablet", "desktop"):
            entry = by_device.get((route, name))
            if entry:
                splits[name] = {metric: _cell(metric, entry.get(metric), min_samples) for metric in CORE_VITALS}
        views = max((cell["samples"] for cell in cells.values()), default=0)
        rating = worst([cells[metric]["rating"] for metric in CORE_VITALS])
        items.append(
            {
                "route": route,
                "page_views": views,
                "enough_data": views >= min_samples,
                "rating": rating,
                "metrics": cells,
                "splits": splits,
            }
        )
    items.sort(
        key=lambda item: (
            -(RATING_ORDER.get(item["rating"], -1)),
            -(item["metrics"]["LCP"]["p75"] or 0),
            -item["page_views"],
        )
    )
    return {"routes": items, "min_samples": min_samples, "filters": {"device": device, "nav_type": nav_type}}


LOAD_COLUMNS = (
    "ttfb_ms",
    "dom_content_loaded_ms",
    "load_ms",
    "transfer_bytes",
    "js_bytes",
    "resource_count",
    "long_task_count",
    "long_task_ms",
    "tbt_ms",
)


def _load_breakdown(db: Session, project_id, window: Window, route: str, device, nav_type) -> dict:
    where, params = _filters(window, device, nav_type)
    params.update({"project_id": project_id, "route": route})
    selects = ", ".join(
        f"percentile_cont(0.75) WITHIN GROUP (ORDER BY {col}) FILTER (WHERE {col} IS NOT NULL) AS {col}"
        for col in LOAD_COLUMNS
    )
    row = db.execute(
        text(f"SELECT count(*) AS n, {selects} FROM page_loads WHERE project_id = :project_id AND route = :route {where}"),
        params,
    ).one()
    out = {"page_views": int(row.n)}
    for col in LOAD_COLUMNS:
        value = getattr(row, col)
        out[col] = None if value is None else round(float(value), 1)
    return out


def _distribution(db: Session, project_id, window: Window, route: str, metric: str, device, nav_type) -> dict:
    good, poor = VITAL_THRESHOLDS[metric]
    top = poor * 1.5
    bins = 12
    where, params = _filters(window, device, nav_type)
    params.update({"project_id": project_id, "route": route, "metric": metric, "top": top, "bins": bins})
    rows = db.execute(
        text(
            f"""
            SELECT width_bucket(least(value, :top - 1e-9), 0, :top, :bins) AS bin, count(*) AS n
            FROM web_vitals
            WHERE project_id = :project_id AND route = :route AND metric = :metric {where}
            GROUP BY bin
            """
        ),
        params,
    ).all()
    counts = [0] * bins
    for row in rows:
        index = int(row.bin) - 1
        if 0 <= index < bins:
            counts[index] = int(row.n)
    width = top / bins
    return {
        "metric": metric,
        "bins": [
            {
                "from": round(i * width, 4),
                "to": round((i + 1) * width, 4),
                "count": counts[i],
                "rating": rate(metric, i * width + width / 2),
            }
            for i in range(bins)
        ],
        "cap": round(top, 4),
    }


def _trend(db: Session, project_id, window: Window, route: str, device, nav_type, min_per_bucket: int = 3) -> list[dict]:
    where, params = _filters(window, device, nav_type)
    params.update({"project_id": project_id, "route": route})
    interval = INTERVALS.get(window.resolution, "1 minute")
    rows = db.execute(
        text(
            f"""
            SELECT time_bucket(CAST(:interval AS interval), time) AS bucket, metric, count(*) AS n,
                   percentile_cont(0.75) WITHIN GROUP (ORDER BY value) AS p75
            FROM web_vitals
            WHERE project_id = :project_id AND route = :route AND metric IN ('LCP','INP','CLS') {where}
            GROUP BY bucket, metric
            ORDER BY bucket
            """
        ),
        {**params, "interval": interval},
    ).all()
    points: dict[datetime, dict] = {}
    for row in rows:
        point = points.setdefault(row.bucket, {"time": iso(row.bucket)})
        point[row.metric] = _round(row.p75, row.metric) if row.n >= min_per_bucket else None
    return list(points.values())


def build_route_detail(
    db: Session,
    project: Project,
    window: Window,
    route: str,
    device: str | None = None,
    nav_type: str | None = None,
    min_samples: int = VITALS_MIN_SAMPLES,
) -> dict:
    summary = build_routes(db, project, window, device, nav_type, min_samples)
    item = next((entry for entry in summary["routes"] if entry["route"] == route), None)
    if item is None:
        item = {"route": route, "page_views": 0, "enough_data": False, "rating": None, "metrics": {}, "splits": {}}
    return {
        "route": route,
        "field": {
            "source": "field",
            "summary": item,
            "distribution": [_distribution(db, project.id, window, route, m, device, nav_type) for m in CORE_VITALS],
            "trend": _trend(db, project.id, window, route, device, nav_type),
            "load": {
                "all": _load_breakdown(db, project.id, window, route, device, nav_type),
                "first_load": _load_breakdown(db, project.id, window, route, device, "first_load"),
                "spa_navigation": _load_breakdown(db, project.id, window, route, device, "spa_navigation"),
            },
        },
        "lab": lab_for_route(db, project, route),
        "min_samples": min_samples,
    }


def page_out(row: PageResult) -> dict:
    return {
        "route": row.route,
        "form_factor": row.form_factor,
        "metric_source": row.metric_source,
        "status": row.status,
        "error_summary": row.error_summary,
        "perf_score": row.perf_score,
        "lcp_ms": row.lcp_ms,
        "cls": row.cls,
        "inp_ms": row.inp_ms,
        "tbt_ms": row.tbt_ms,
        "fcp_ms": row.fcp_ms,
        "ttfb_ms": row.ttfb_ms,
        "speed_index": row.speed_index,
        "script_ms": row.script_ms,
        "long_task_count": row.long_task_count,
        "long_task_total_ms": row.long_task_total_ms,
        "total_transfer_bytes": row.total_transfer_bytes,
        "resource_count": row.resource_count,
        "resource_summary": row.resource_summary_json or {},
        "diagnosis": row.diagnosis_json or [],
        "ratings": {
            "LCP": rate("LCP", row.lcp_ms),
            "CLS": rate("CLS", row.cls),
            "FCP": rate("FCP", row.fcp_ms),
            "TTFB": rate("TTFB", row.ttfb_ms),
        },
    }


def latest_lab_scan(db: Session, project: Project) -> ScanRun | None:
    return (
        db.query(ScanRun)
        .filter(ScanRun.project_id == project.id, ScanRun.mode == "vitals", ScanRun.status.in_(("completed", "partial")))
        .order_by(ScanRun.created_at.desc())
        .first()
    )


def build_lab(db: Session, project: Project) -> dict:
    scan = latest_lab_scan(db, project)
    if scan is None:
        return {"scan": None, "pages": []}
    rows = (
        db.query(PageResult)
        .filter(PageResult.scan_id == scan.id, PageResult.metric_source == "lab")
        .order_by(PageResult.route, PageResult.form_factor)
        .all()
    )
    return {
        "scan": {
            "id": str(scan.id),
            "status": scan.status,
            "completed_at": iso(scan.completed_at),
            "base_url": (scan.config_json or {}).get("base_url"),
        },
        "pages": [page_out(row) for row in rows],
    }


def lab_for_route(db: Session, project: Project, route: str) -> dict:
    lab = build_lab(db, project)
    return {
        "source": "lab",
        "scan": lab["scan"],
        "pages": [page for page in lab["pages"] if page["route"] == route],
    }
