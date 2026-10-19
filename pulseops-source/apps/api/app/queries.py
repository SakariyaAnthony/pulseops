"""Read path. Dashboards query the 1-minute continuous aggregate, not raw rows."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import unquote
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.constants import BUCKET_EDGES, HIST_COLS, METRIC_COLS
from app.models import AlertIncident, Project
from app.serialize import incident_out
from app.stats import (
    INTERVALS,
    WIDTH_MINUTES,
    Window,
    delta_pct,
    estimate_percentile,
    health_of,
    to_ms,
)

RESOURCE_METRICS = (
    "cpu_pct",
    "mem_rss_mb",
    "heap_used_mb",
    "disk_read_bps",
    "disk_write_bps",
    "net_in_bps",
    "net_out_bps",
    "event_loop_lag_ms",
    "gc_pause_ms",
)

TIMESERIES_METRICS = {
    "response_time",
    "throughput",
    "error_rate",
    "cpu",
    "memory",
    "disk_read",
    "disk_write",
    "net_in",
    "net_out",
}

_RESOURCE_SQL = {
    "cpu": "cpu_pct",
    "memory": "mem_rss_mb",
    "disk_read": "disk_read_bps",
    "disk_write": "disk_write_bps",
    "net_in": "net_in_bps",
    "net_out": "net_out_bps",
}


def _agg_sql() -> str:
    parts = []
    for col in METRIC_COLS:
        fn = "max" if col == "max_ms" else "sum"
        parts.append(f"{fn}({col}) AS {col}")
    return ", ".join(parts)


AGG_SQL = _agg_sql()

WHERE_SQL = """
project_id = :project_id
AND bucket >= :start
AND bucket < :end
AND (CAST(:env AS text) IS NULL OR env = :env)
AND (CAST(:service AS text) IS NULL OR service = :service)
AND (CAST(:method AS text) IS NULL OR method = :method)
AND (CAST(:route AS text) IS NULL OR route = :route)
"""


@dataclass
class Totals:
    calls: float = 0
    sum_ms: float = 0
    max_ms: float = 0
    s2xx: float = 0
    s3xx: float = 0
    s4xx: float = 0
    s5xx: float = 0
    satisfied: float = 0
    tolerating: float = 0
    hist: tuple[float, ...] = tuple(0 for _ in HIST_COLS)

    @classmethod
    def from_row(cls, row) -> "Totals":
        if row is None or row["calls"] is None:
            return cls()
        return cls(
            calls=float(row["calls"] or 0),
            sum_ms=float(row["sum_ms"] or 0),
            max_ms=float(row["max_ms"] or 0),
            s2xx=float(row["s2xx"] or 0),
            s3xx=float(row["s3xx"] or 0),
            s4xx=float(row["s4xx"] or 0),
            s5xx=float(row["s5xx"] or 0),
            satisfied=float(row["satisfied"] or 0),
            tolerating=float(row["tolerating"] or 0),
            hist=tuple(float(row[col] or 0) for col in HIST_COLS),
        )

    @property
    def avg_ms(self) -> float:
        return self.sum_ms / self.calls if self.calls else 0.0

    @property
    def error_pct(self) -> float:
        return (self.s5xx / self.calls * 100) if self.calls else 0.0

    @property
    def apdex(self) -> float:
        if not self.calls:
            return 0.0
        return (self.satisfied + self.tolerating / 2) / self.calls

    def percentile(self, p: float) -> float:
        value = estimate_percentile(self.calls, list(self.hist), p)
        return 0.0 if value is None else value

    def rpm(self, minutes: float) -> float:
        return self.calls / minutes if minutes else 0.0


def _params(project_id, window: Window, service=None, method=None, route=None) -> dict:
    return {
        "project_id": project_id,
        "start": window.start,
        "end": window.end,
        "env": window.env,
        "service": service,
        "method": method,
        "route": route,
    }


def _fetch_totals(db: Session, project_id, window: Window, service=None, method=None, route=None) -> Totals:
    row = db.execute(
        text(f"SELECT {AGG_SQL} FROM request_metrics_1m WHERE {WHERE_SQL}"),
        _params(project_id, window, service, method, route),
    ).mappings().one()
    return Totals.from_row(row)


def _fetch_buckets(
    db: Session, project_id, window: Window, service=None, method=None, route=None
) -> list[tuple[datetime, Totals]]:
    interval = INTERVALS[window.resolution]
    rows = db.execute(
        text(
            f"""
            SELECT time_bucket('{interval}', bucket) AS t, {AGG_SQL}
            FROM request_metrics_1m
            WHERE {WHERE_SQL}
            GROUP BY t
            ORDER BY t
            """
        ),
        _params(project_id, window, service, method, route),
    ).mappings()
    return [(row["t"], Totals.from_row(row)) for row in rows]


def _fetch_groups(db: Session, project_id, window: Window, service=None) -> list[dict]:
    rows = db.execute(
        text(
            f"""
            SELECT service, method, route, {AGG_SQL}
            FROM request_metrics_1m
            WHERE {WHERE_SQL}
            GROUP BY service, method, route
            """
        ),
        _params(project_id, window, service=service),
    ).mappings()
    groups = []
    for row in rows:
        totals = Totals.from_row(row)
        groups.append(
            {
                "service": row["service"],
                "method": row["method"],
                "route": row["route"],
                "totals": totals,
            }
        )
    return groups


def _deploys(db: Session, project_id, window: Window, service: str | None = None) -> list[dict]:
    rows = db.execute(
        text(
            """
            SELECT deployed_at, version, service, commit_sha, env
            FROM deploys
            WHERE project_id = :project_id
              AND deployed_at >= :start
              AND deployed_at < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
              AND (CAST(:service AS text) IS NULL OR service = :service)
            ORDER BY deployed_at
            """
        ),
        {
            "project_id": project_id,
            "start": window.start,
            "end": window.end,
            "env": window.env,
            "service": service,
        },
    ).mappings()
    seen: set[tuple[int, str]] = set()
    markers = []
    detailed = []
    for row in rows:
        stamp = to_ms(row["deployed_at"])
        key = (stamp, row["version"])
        detailed.append(
            {
                "time": stamp,
                "version": row["version"],
                "service": row["service"],
                "commit_sha": row["commit_sha"],
                "environment": row["env"],
            }
        )
        if key in seen:
            continue
        seen.add(key)
        markers.append({"time": stamp, "version": row["version"]})
    return markers, detailed


def _window_meta(window: Window) -> dict:
    return {
        "range": window.label,
        "environment": window.env,
        "from": to_ms(window.start),
        "to": to_ms(window.end),
        "resolution": window.resolution,
    }


def _round(value: float, digits: int = 2) -> float:
    return round(float(value), digits)


def _spark(buckets: list[tuple[datetime, Totals]], pick) -> list[list[float]]:
    return [[to_ms(ts), _round(pick(totals), 3)] for ts, totals in buckets]


def _kpi(current: float, previous: float, sparkline: list, digits: int = 2) -> dict:
    return {
        "value": _round(current, digits),
        "delta_pct": delta_pct(current, previous),
        "sparkline": sparkline,
    }


def _endpoint_key(method: str, route: str) -> str:
    return f"{method} {route}"


def _endpoint_dict(group: dict, minutes: float) -> dict:
    totals: Totals = group["totals"]
    return {
        "key": _endpoint_key(group["method"], group["route"]),
        "method": group["method"],
        "route": group["route"],
        "service": group["service"],
        "calls": int(round(totals.calls)),
        "avg_ms": _round(totals.avg_ms),
        "p50_ms": _round(totals.percentile(0.50)),
        "p95_ms": _round(totals.percentile(0.95)),
        "p99_ms": _round(totals.percentile(0.99)),
        "max_ms": _round(totals.max_ms),
        "error_pct": _round(totals.error_pct, 3),
        "apdex": _round(totals.apdex, 3),
        "rpm": _round(totals.rpm(minutes), 2),
    }


def response_time_series(buckets, markers) -> dict:
    return {
        "metric": "response_time",
        "resolution": "",
        "series": [
            {"name": "p50", "points": _spark(buckets, lambda t: t.percentile(0.50))},
            {"name": "p95", "points": _spark(buckets, lambda t: t.percentile(0.95))},
            {"name": "p99", "points": _spark(buckets, lambda t: t.percentile(0.99))},
        ],
        "deploys": markers,
    }


def throughput_series(buckets, markers, resolution: str) -> dict:
    width = WIDTH_MINUTES[resolution]
    return {
        "metric": "throughput",
        "resolution": resolution,
        "series": [{"name": "rpm", "points": _spark(buckets, lambda t: t.calls / width)}],
        "deploys": markers,
    }


def error_series(buckets, markers, resolution: str) -> dict:
    return {
        "metric": "error_rate",
        "resolution": resolution,
        "series": [{"name": "error_pct", "points": _spark(buckets, lambda t: t.error_pct)}],
        "deploys": markers,
    }


def build_overview(db: Session, project: Project, window: Window) -> dict:
    current = _fetch_totals(db, project.id, window)
    previous_window = window.previous()
    previous = _fetch_totals(db, project.id, previous_window)
    buckets = _fetch_buckets(db, project.id, window)
    markers, _ = _deploys(db, project.id, window)
    groups = _fetch_groups(db, project.id, window)
    hosts = _hosts_by_service(db, project.id, window)
    resources = _resource_headline(db, project.id, window)

    latency = response_time_series(buckets, markers)
    latency["resolution"] = window.resolution
    throughput = throughput_series(buckets, markers, window.resolution)

    services = []
    for group in _collapse_services(groups):
        totals: Totals = group["totals"]
        p95 = totals.percentile(0.95)
        services.append(
            {
                "name": group["service"],
                "health": health_of(p95, totals.error_pct),
                "avg_ms": _round(totals.avg_ms),
                "p95_ms": _round(p95),
                "rpm": _round(totals.rpm(window.minutes), 2),
                "error_pct": _round(totals.error_pct, 3),
                "apdex": _round(totals.apdex, 3),
                "instances": hosts.get(group["service"], 0),
            }
        )
    services.sort(key=lambda item: item["rpm"], reverse=True)

    endpoints = [_endpoint_dict(group, window.minutes) for group in groups]
    endpoints.sort(key=lambda item: item["p95_ms"], reverse=True)

    incidents = (
        db.query(AlertIncident)
        .filter(AlertIncident.project_id == project.id, AlertIncident.status == "firing")
        .order_by(AlertIncident.started_at.desc())
        .limit(8)
        .all()
    )

    return {
        "project_id": str(project.id),
        "slug": project.slug,
        **_window_meta(window),
        "kpis": {
            "avg_ms": _kpi(current.avg_ms, previous.avg_ms, _spark(buckets, lambda t: t.avg_ms)),
            "p95_ms": _kpi(
                current.percentile(0.95),
                previous.percentile(0.95),
                _spark(buckets, lambda t: t.percentile(0.95)),
            ),
            "rpm": _kpi(
                current.rpm(window.minutes),
                previous.rpm(previous_window.minutes),
                _spark(buckets, lambda t: t.calls / WIDTH_MINUTES[window.resolution]),
                1,
            ),
            "error_pct": _kpi(current.error_pct, previous.error_pct, _spark(buckets, lambda t: t.error_pct), 3),
            "apdex": _kpi(current.apdex, previous.apdex, _spark(buckets, lambda t: t.apdex), 3),
        },
        "response_time": latency,
        "throughput": throughput,
        "resources": resources,
        "slow_endpoints": endpoints[:5],
        "services": services,
        "incidents": [incident_out(item) for item in incidents],
    }


def _collapse_services(groups: list[dict]) -> list[dict]:
    merged: dict[str, Totals] = {}
    for group in groups:
        current = merged.get(group["service"])
        totals: Totals = group["totals"]
        if current is None:
            merged[group["service"]] = Totals(
                calls=totals.calls,
                sum_ms=totals.sum_ms,
                max_ms=totals.max_ms,
                s2xx=totals.s2xx,
                s3xx=totals.s3xx,
                s4xx=totals.s4xx,
                s5xx=totals.s5xx,
                satisfied=totals.satisfied,
                tolerating=totals.tolerating,
                hist=totals.hist,
            )
            continue
        merged[group["service"]] = Totals(
            calls=current.calls + totals.calls,
            sum_ms=current.sum_ms + totals.sum_ms,
            max_ms=max(current.max_ms, totals.max_ms),
            s2xx=current.s2xx + totals.s2xx,
            s3xx=current.s3xx + totals.s3xx,
            s4xx=current.s4xx + totals.s4xx,
            s5xx=current.s5xx + totals.s5xx,
            satisfied=current.satisfied + totals.satisfied,
            tolerating=current.tolerating + totals.tolerating,
            hist=tuple(a + b for a, b in zip(current.hist, totals.hist)),
        )
    return [{"service": name, "totals": totals} for name, totals in merged.items()]


def _hosts_by_service(db: Session, project_id, window: Window) -> dict[str, int]:
    rows = db.execute(
        text(
            """
            SELECT service, count(DISTINCT host) AS instances
            FROM request_metrics
            WHERE project_id = :project_id
              AND time >= :start AND time < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
            GROUP BY service
            """
        ),
        {"project_id": project_id, "start": window.start, "end": window.end, "env": window.env},
    ).mappings()
    return {row["service"]: int(row["instances"]) for row in rows}


def _resource_rows(db: Session, project_id, window: Window, host: str | None = None):
    interval = INTERVALS[window.resolution]
    return db.execute(
        text(
            f"""
            SELECT time_bucket('{interval}', time) AS t,
                   host,
                   avg(cpu_pct) AS cpu_pct,
                   avg(mem_rss_mb) AS mem_rss_mb,
                   avg(heap_used_mb) AS heap_used_mb,
                   avg(disk_read_bps) AS disk_read_bps,
                   avg(disk_write_bps) AS disk_write_bps,
                   avg(net_in_bps) AS net_in_bps,
                   avg(net_out_bps) AS net_out_bps,
                   avg(event_loop_lag_ms) AS event_loop_lag_ms,
                   avg(gc_pause_ms) AS gc_pause_ms
            FROM resource_metrics
            WHERE project_id = :project_id
              AND time >= :start AND time < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
              AND (CAST(:host AS text) IS NULL OR host = :host)
            GROUP BY t, host
            ORDER BY t
            """
        ),
        {
            "project_id": project_id,
            "start": window.start,
            "end": window.end,
            "env": window.env,
            "host": host,
        },
    ).mappings().all()


def _resource_headline(db: Session, project_id, window: Window) -> dict:
    rows = _resource_rows(db, project_id, window)
    by_time: dict[datetime, list] = {}
    for row in rows:
        by_time.setdefault(row["t"], []).append(row)
    cpu_points = []
    mem_points = []
    for stamp in sorted(by_time):
        bucket = by_time[stamp]
        cpu_points.append([to_ms(stamp), _round(sum(r["cpu_pct"] or 0 for r in bucket) / len(bucket))])
        mem_points.append([to_ms(stamp), _round(sum(r["mem_rss_mb"] or 0 for r in bucket) / len(bucket))])
    latest_cpu = cpu_points[-1][1] if cpu_points else 0
    latest_mem = mem_points[-1][1] if mem_points else 0
    markers, _ = _deploys(db, project_id, window)
    return {
        "cpu_pct": latest_cpu,
        "mem_rss_mb": latest_mem,
        "cpu": {
            "metric": "cpu",
            "resolution": window.resolution,
            "series": [{"name": "avg", "points": cpu_points}],
            "deploys": markers,
        },
        "memory": {
            "metric": "memory",
            "resolution": window.resolution,
            "series": [{"name": "avg", "points": mem_points}],
            "deploys": markers,
        },
    }


def build_timeseries(
    db: Session,
    project: Project,
    window: Window,
    metric: str,
    service: str | None = None,
    method: str | None = None,
    route: str | None = None,
    host: str | None = None,
    group_by: str | None = None,
) -> dict:
    if metric not in TIMESERIES_METRICS:
        raise ValueError("unknown metric")
    markers, _ = _deploys(db, project.id, window, service=service)
    if metric in _RESOURCE_SQL:
        column = _RESOURCE_SQL[metric]
        rows = _resource_rows(db, project.id, window, host=host)
        grouped: dict[str, list] = {}
        for row in rows:
            name = row["host"] or "all"
            if group_by == "host" or host is None:
                grouped.setdefault(name, []).append([to_ms(row["t"]), _round(row[column] or 0)])
            else:
                grouped.setdefault(host, []).append([to_ms(row["t"]), _round(row[column] or 0)])
        if host is not None:
            series = [{"name": host, "points": grouped.get(host, [])}]
        else:
            series = [{"name": name, "points": points} for name, points in sorted(grouped.items())]
        return {
            "metric": metric,
            "resolution": window.resolution,
            "series": series,
            "deploys": markers,
        }

    if group_by == "service":
        groups = _fetch_service_buckets(db, project.id, window, service)
        series = []
        for name, buckets in groups.items():
            if metric == "throughput":
                width = WIDTH_MINUTES[window.resolution]
                points = _spark(buckets, lambda t: t.calls / width)
            elif metric == "error_rate":
                points = _spark(buckets, lambda t: t.error_pct)
            else:
                points = _spark(buckets, lambda t: t.percentile(0.95))
            series.append({"name": name, "points": points})
        return {
            "metric": metric,
            "resolution": window.resolution,
            "series": series,
            "deploys": markers,
        }

    buckets = _fetch_buckets(db, project.id, window, service, method, route)
    if metric == "throughput":
        return throughput_series(buckets, markers, window.resolution)
    if metric == "error_rate":
        return error_series(buckets, markers, window.resolution)
    payload = response_time_series(buckets, markers)
    payload["resolution"] = window.resolution
    return payload


def _fetch_service_buckets(db: Session, project_id, window: Window, service: str | None):
    interval = INTERVALS[window.resolution]
    rows = db.execute(
        text(
            f"""
            SELECT time_bucket('{interval}', bucket) AS t, service, {AGG_SQL}
            FROM request_metrics_1m
            WHERE {WHERE_SQL}
            GROUP BY t, service
            ORDER BY t
            """
        ),
        _params(project_id, window, service=service),
    ).mappings()
    grouped: dict[str, list[tuple[datetime, Totals]]] = {}
    for row in rows:
        grouped.setdefault(row["service"], []).append((row["t"], Totals.from_row(row)))
    return grouped


def build_services(db: Session, project: Project, window: Window) -> dict:
    overview = build_overview(db, project, window)
    return {**_window_meta(window), "services": overview["services"]}


def build_service_detail(db: Session, project: Project, window: Window, service: str) -> dict:
    totals = _fetch_totals(db, project.id, window, service=service)
    groups = _fetch_groups(db, project.id, window, service=service)
    markers, detailed = _deploys(db, project.id, window, service=service)
    hosts = _hosts_by_service(db, project.id, window)
    resources = _resource_headline(db, project.id, window)
    endpoints = [_endpoint_dict(group, window.minutes) for group in groups]
    endpoints.sort(key=lambda item: item["p95_ms"], reverse=True)
    p95 = totals.percentile(0.95)
    return {
        "name": service,
        "health": health_of(p95, totals.error_pct) if totals.calls else "unknown",
        **_window_meta(window),
        "calls": int(round(totals.calls)),
        "avg_ms": _round(totals.avg_ms),
        "p50_ms": _round(totals.percentile(0.50)),
        "p95_ms": _round(p95),
        "p99_ms": _round(totals.percentile(0.99)),
        "rpm": _round(totals.rpm(window.minutes), 2),
        "error_pct": _round(totals.error_pct, 3),
        "apdex": _round(totals.apdex, 3),
        "instances": hosts.get(service, 0),
        "endpoints": endpoints,
        "resources": {
            "cpu_pct": resources["cpu_pct"],
            "mem_rss_mb": resources["mem_rss_mb"],
        },
        "deploys": detailed,
        "response_time": {**response_time_series(_fetch_buckets(db, project.id, window, service=service), markers), "resolution": window.resolution},
    }


def build_endpoints(
    db: Session,
    project: Project,
    window: Window,
    *,
    service: str | None,
    method: str | None,
    q: str | None,
    sort: str,
    limit: int,
    offset: int,
) -> dict:
    groups = _fetch_groups(db, project.id, window, service=service)
    if method:
        groups = [group for group in groups if group["method"].upper() == method.upper()]
    if q:
        needle = q.lower()
        groups = [group for group in groups if needle in group["route"].lower() or needle in group["service"].lower()]
    rows = [_endpoint_dict(group, window.minutes) for group in groups]
    sparklines = _endpoint_sparklines(db, project.id, window, service)
    for row in rows:
        row["sparkline"] = sparklines.get((row["service"], row["method"], row["route"]), [])
    sort_keys = {
        "p95": lambda item: item["p95_ms"],
        "avg": lambda item: item["avg_ms"],
        "calls": lambda item: item["calls"],
        "error_pct": lambda item: item["error_pct"],
        "apdex": lambda item: item["apdex"],
        "route": lambda item: item["route"],
    }
    rows.sort(key=sort_keys[sort], reverse=sort not in {"route", "apdex"})
    total = len(rows)
    page = rows[offset : offset + limit]
    return {**_window_meta(window), "total": total, "endpoints": page}


def _endpoint_sparklines(db: Session, project_id, window: Window, service: str | None):
    interval = INTERVALS[window.resolution]
    rows = db.execute(
        text(
            f"""
            SELECT time_bucket('{interval}', bucket) AS t, service, method, route, {AGG_SQL}
            FROM request_metrics_1m
            WHERE {WHERE_SQL}
            GROUP BY t, service, method, route
            ORDER BY t
            """
        ),
        _params(project_id, window, service=service),
    ).mappings()
    grouped: dict[tuple, list] = {}
    for row in rows:
        key = (row["service"], row["method"], row["route"])
        totals = Totals.from_row(row)
        grouped.setdefault(key, []).append([to_ms(row["t"]), _round(totals.percentile(0.95))])
    return grouped


def parse_endpoint_key(key: str) -> tuple[str, str]:
    decoded = unquote(key).strip()
    if " " not in decoded:
        raise ValueError("endpoint key must look like 'GET /path'")
    method, route = decoded.split(" ", 1)
    return method.upper(), route


def build_endpoint_detail(db: Session, project: Project, window: Window, key: str) -> dict | None:
    method, route = parse_endpoint_key(key)
    groups = _fetch_groups(db, project.id, window)
    match = next((group for group in groups if group["method"] == method and group["route"] == route), None)
    if match is None:
        return None
    totals: Totals = match["totals"]
    buckets = _fetch_buckets(db, project.id, window, service=match["service"], method=method, route=route)
    markers, _ = _deploys(db, project.id, window, service=match["service"])
    body = _endpoint_dict(match, window.minutes)
    prev = 0.0
    histogram = []
    for edge, count in zip(BUCKET_EDGES, totals.hist):
        histogram.append({"le": edge, "count": int(round(max(count - prev, 0)))})
        prev = count
    if totals.calls > prev:
        histogram.append({"le": None, "count": int(round(totals.calls - prev))})
    latency = response_time_series(buckets, markers)
    latency["resolution"] = window.resolution
    body.update(
        {
            **_window_meta(window),
            "histogram": histogram,
            "status": {
                "2xx": int(round(totals.s2xx)),
                "3xx": int(round(totals.s3xx)),
                "4xx": int(round(totals.s4xx)),
                "5xx": int(round(totals.s5xx)),
            },
            "response_time": latency,
            "throughput": throughput_series(buckets, markers, window.resolution),
        }
    )
    return body


def build_resources(db: Session, project: Project, window: Window, host: str | None) -> dict:
    rows = _resource_rows(db, project.id, window, host=host)
    hosts = sorted({row["host"] for row in rows if row["host"]})
    series: dict[str, dict[str, list]] = {metric: {} for metric in RESOURCE_METRICS}
    for row in rows:
        name = row["host"] or "all"
        stamp = to_ms(row["t"])
        for metric in RESOURCE_METRICS:
            series[metric].setdefault(name, []).append([stamp, _round(row[metric] or 0)])
    latest = {metric: 0 for metric in RESOURCE_METRICS}
    if rows:
        last_time = max(row["t"] for row in rows)
        last_rows = [row for row in rows if row["t"] == last_time]
        for metric in RESOURCE_METRICS:
            values = [row[metric] or 0 for row in last_rows]
            latest[metric] = _round(sum(values) / len(values)) if values else 0
    markers, _ = _deploys(db, project.id, window)
    metrics = {}
    for metric, by_host in series.items():
        metrics[metric] = {
            "metric": metric,
            "resolution": window.resolution,
            "series": [{"name": name, "points": points} for name, points in sorted(by_host.items())],
            "deploys": markers,
        }
    return {
        **_window_meta(window),
        "hosts": hosts,
        "latest": latest,
        "metrics": metrics,
        "thresholds": {
            "cpu_pct": {"warning": 70, "critical": 85},
            "mem_rss_mb": {"warning": 1400, "critical": 1800},
            "event_loop_lag_ms": {"warning": 50, "critical": 100},
        },
    }


def build_errors(db: Session, project: Project, window: Window) -> dict:
    interval = INTERVALS[window.resolution]
    rows = db.execute(
        text(
            """
            SELECT fingerprint,
                   count(*) AS count,
                   min(time) AS first_seen,
                   max(time) AS last_seen,
                   (array_agg(type ORDER BY time DESC))[1] AS type,
                   (array_agg(message ORDER BY time DESC))[1] AS message,
                   (array_agg(service ORDER BY time DESC))[1] AS service,
                   (array_agg(route ORDER BY time DESC))[1] AS route
            FROM error_events
            WHERE project_id = :project_id
              AND time >= :start AND time < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
            GROUP BY fingerprint
            ORDER BY count DESC
            """
        ),
        {"project_id": project.id, "start": window.start, "end": window.end, "env": window.env},
    ).mappings().all()
    sparks = db.execute(
        text(
            f"""
            SELECT fingerprint, time_bucket('{interval}', time) AS t, count(*) AS count
            FROM error_events
            WHERE project_id = :project_id
              AND time >= :start AND time < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
            GROUP BY fingerprint, t
            ORDER BY t
            """
        ),
        {"project_id": project.id, "start": window.start, "end": window.end, "env": window.env},
    ).mappings()
    spark_map: dict[str, list] = {}
    for row in sparks:
        spark_map.setdefault(row["fingerprint"], []).append([to_ms(row["t"]), int(row["count"])])
    groups = [
        {
            "fingerprint": row["fingerprint"],
            "type": row["type"],
            "message": row["message"],
            "service": row["service"],
            "route": row["route"],
            "count": int(row["count"]),
            "first_seen": to_ms(row["first_seen"]),
            "last_seen": to_ms(row["last_seen"]),
            "sparkline": spark_map.get(row["fingerprint"], []),
        }
        for row in rows
    ]
    return {**_window_meta(window), "groups": groups}


def build_error_detail(db: Session, project: Project, window: Window, fingerprint: str) -> dict | None:
    summary = db.execute(
        text(
            """
            SELECT count(*) AS count,
                   min(time) AS first_seen,
                   max(time) AS last_seen,
                   (array_agg(type ORDER BY time DESC))[1] AS type,
                   (array_agg(message ORDER BY time DESC))[1] AS message,
                   (array_agg(stack ORDER BY time DESC))[1] AS stack,
                   (array_agg(service ORDER BY time DESC))[1] AS service,
                   (array_agg(route ORDER BY time DESC))[1] AS route
            FROM error_events
            WHERE project_id = :project_id
              AND fingerprint = :fingerprint
              AND time >= :start AND time < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
            """
        ),
        {
            "project_id": project.id,
            "fingerprint": fingerprint,
            "start": window.start,
            "end": window.end,
            "env": window.env,
        },
    ).mappings().one()
    if not summary["count"]:
        return None
    events = db.execute(
        text(
            """
            SELECT time, env, service, route, trace_id, context
            FROM error_events
            WHERE project_id = :project_id
              AND fingerprint = :fingerprint
              AND time >= :start AND time < :end
              AND (CAST(:env AS text) IS NULL OR env = :env)
            ORDER BY time DESC
            LIMIT 50
            """
        ),
        {
            "project_id": project.id,
            "fingerprint": fingerprint,
            "start": window.start,
            "end": window.end,
            "env": window.env,
        },
    ).mappings()
    return {
        "fingerprint": fingerprint,
        "type": summary["type"],
        "message": summary["message"],
        "stack": summary["stack"],
        "service": summary["service"],
        "route": summary["route"],
        "count": int(summary["count"]),
        "first_seen": to_ms(summary["first_seen"]),
        "last_seen": to_ms(summary["last_seen"]),
        **_window_meta(window),
        "events": [
            {
                "time": to_ms(row["time"]),
                "env": row["env"],
                "service": row["service"],
                "route": row["route"],
                "trace_id": row["trace_id"],
                "context": row["context"] if isinstance(row["context"], dict) else json.loads(row["context"] or "{}"),
            }
            for row in events
        ],
    }


def build_snapshot(db: Session, project_id: UUID) -> dict:
    end = datetime.now(timezone.utc)
    window = Window("1m", end - timedelta(minutes=1), end, None, "1m")
    totals = _fetch_totals(db, project_id, window)
    resources = _resource_headline(db, project_id, window)
    return {
        "project_id": str(project_id),
        "time": to_ms(end),
        "rps": _round(totals.calls / 60.0, 2),
        "avg_ms": _round(totals.avg_ms),
        "p95_ms": _round(totals.percentile(0.95)),
        "error_pct": _round(totals.error_pct, 3),
        "cpu_pct": resources["cpu_pct"],
        "mem_rss_mb": resources["mem_rss_mb"],
    }


def firing_incidents(db: Session, project_id: UUID) -> list[AlertIncident]:
    return (
        db.query(AlertIncident)
        .filter(AlertIncident.project_id == project_id, AlertIncident.status == "firing")
        .order_by(AlertIncident.started_at.desc())
        .all()
    )
