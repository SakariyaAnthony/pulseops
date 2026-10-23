"""Demo shop with about 24 hours of traffic, errors, and two firing incidents."""

from __future__ import annotations

import argparse
import math
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

from app.constants import (
    DEMO_API_KEY,
    DEMO_API_KEY_ID,
    DEMO_API_KEY_PREFIX,
    DEMO_EMAIL,
    DEMO_ENV_PROD_ID,
    DEMO_ENV_STAGING_ID,
    DEMO_NAME,
    DEMO_PASSWORD,
    DEMO_PROJECT_ID,
    DEMO_PROJECT_NAME,
    DEMO_PROJECT_SLUG,
    DEMO_USER_ID,
    INCIDENT_CHECKOUT_ID,
    INCIDENT_PAYMENTS_ID,
    RULE_CHECKOUT_ID,
    RULE_PAYMENTS_ID,
)
from app.db import SessionLocal, engine
from app.models import AlertIncident, AlertRule, ApiKey, Deploy, Environment, Project, User
from app.security import hash_api_key, hash_password

HOSTS = ("shop-api-1", "shop-api-2", "shop-api-3")
SERVICES = ("gateway", "catalog", "cart", "orders", "checkout", "payments")

# service, method, route, requests/min at peak, p50 ms, p95 ms, 5xx fraction
ENDPOINTS = (
    ("catalog", "GET", "/api/products", 2800, 42, 110, 0.001),
    ("catalog", "GET", "/api/products/:id", 1500, 36, 95, 0.001),
    ("catalog", "GET", "/api/search", 860, 75, 210, 0.004),
    ("cart", "GET", "/api/cart", 640, 52, 140, 0.002),
    ("cart", "POST", "/api/cart/items", 380, 68, 190, 0.003),
    ("orders", "GET", "/api/orders", 320, 88, 230, 0.005),
    ("orders", "GET", "/api/orders/:id", 470, 105, 310, 0.006),
    ("orders", "POST", "/api/orders", 160, 150, 460, 0.009),
    ("checkout", "POST", "/api/checkout", 210, 230, 640, 0.011),
    ("checkout", "GET", "/api/checkout/:id", 240, 64, 170, 0.003),
    ("payments", "POST", "/api/payments", 190, 170, 520, 0.018),
    ("gateway", "GET", "/health", 140, 6, 18, 0.0),
)

PAY_STACK = """TimeoutError: upstream timeout talking to payments.example.com
    at Charge.create (payments/client.py:88)
    at post_payment (payments/routes.py:41)
    at checkout (checkout/service.py:133)"""

CARD_STACK = """ValidationError: card token missing
    at assertToken (checkout/validate.py:22)
    at postCheckout (checkout/routes.py:57)"""

DB_STACK = """QueryCanceled: canceling statement due to statement timeout
    at Order.findById (orders/repo.py:71)
    at getOrder (orders/routes.py:34)"""


def _aligned(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    return current.replace(second=0, microsecond=0)


def _shape(minute: datetime, service: str, method: str, rpm: float, p50: float, p95: float, err: float, env: str, deploy_at: datetime, payments_at: datetime):
    hour = minute.hour + minute.minute / 60
    diurnal = 0.62 + 0.38 * math.sin((hour - 9) / 24 * math.tau)
    diurnal = min(1.0, max(0.4, diurnal))
    wave = 1 + 0.05 * math.sin(minute.timestamp() / 180)
    scale = 0.12 if env == "staging" else 1.0
    rpm *= diurnal * wave * scale
    p50 *= wave
    p95 *= wave
    if env == "staging":
        err *= 0.4
        p95 *= 0.85
        p50 *= 0.9
    if env == "prod" and service == "checkout" and method == "POST" and minute >= deploy_at:
        p50 *= 1.45
        p95 *= 1.9
        err = max(err, 0.032)
    if env == "prod" and service == "payments" and minute >= payments_at:
        p95 *= 1.3
        err = max(err, 0.048)
    return rpm, max(p50, 1), max(p95, 1), err


def _iter_requests(start: datetime, end: datetime, deploy_at: datetime, payments_at: datetime):
    minute = start
    while minute <= end:
        for env in ("prod", "staging"):
            version = "v2.13.9" if env == "staging" else ("v2.14.1" if minute >= deploy_at else "v2.14.0")
            for index, endpoint in enumerate(ENDPOINTS):
                service, method, route, rpm, p50, p95, err = endpoint
                rpm, p50, p95, err = _shape(minute, service, method, rpm, p50, p95, err, env, deploy_at, payments_at)
                bands = (
                    (p50 * 0.9, 0.62, 200),
                    ((p50 + p95) / 2, 0.23, 200),
                    (p95, max(0.15 - err, 0.02), 200),
                    (min(p95 * 1.45, 8000), err, 500),
                )
                host = HOSTS[(minute.minute + index) % len(HOSTS)]
                for duration, frac, status in bands:
                    weight = int(round(rpm * frac))
                    if weight <= 0:
                        continue
                    yield (
                        minute,
                        DEMO_PROJECT_ID,
                        env,
                        service,
                        host,
                        method,
                        route,
                        status,
                        float(duration),
                        None,
                        version,
                        weight,
                    )
        minute += timedelta(minutes=1)


def _iter_resources(start: datetime, end: datetime, deploy_at: datetime):
    minute = start
    while minute <= end:
        hour = minute.hour + minute.minute / 60
        diurnal = min(1.0, max(0.4, 0.62 + 0.38 * math.sin((hour - 9) / 24 * math.tau)))
        for env in ("prod", "staging"):
            for host in HOSTS:
                bias = 10 if host.endswith("1") else 6 if host.endswith("2") else 3
                cpu = 22 + bias + 28 * diurnal
                mem = 680 + 260 * diurnal + (50 if host.endswith("1") else 0)
                lag = 2 + 6 * diurnal
                if env == "prod" and minute >= deploy_at and host.endswith("1"):
                    cpu += 14
                    lag += 8
                    mem += 120
                if env == "staging":
                    cpu *= 0.55
                    mem *= 0.7
                    lag *= 0.6
                cpu = min(cpu, 93)
                yield (
                    minute,
                    DEMO_PROJECT_ID,
                    env,
                    "shop-api",
                    host,
                    round(cpu, 2),
                    round(mem, 1),
                    round(mem * 0.46, 1),
                    int(350_000 + 1_100_000 * diurnal),
                    int(120_000 + 480_000 * diurnal),
                    int(2_000_000 + 9_000_000 * diurnal),
                    int(1_500_000 + 7_000_000 * diurnal),
                    round(lag, 2),
                    round(0.4 + diurnal * 1.6, 2),
                )
        minute += timedelta(minutes=1)


def _copy(sql: str, rows) -> int:
    raw = engine.raw_connection()
    count = 0
    try:
        cursor = raw.cursor()
        with cursor.copy(sql) as copy:
            for row in rows:
                copy.write_row(row)
                count += 1
        raw.commit()
        cursor.close()
    finally:
        raw.close()
    return count


def _refresh() -> None:
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.exec_driver_sql("CALL refresh_continuous_aggregate('request_metrics_1m', NULL, NULL)")


def _ensure_identity(db) -> None:
    user = db.get(User, DEMO_USER_ID)
    if user is None:
        user = User(
            id=DEMO_USER_ID,
            email=DEMO_EMAIL,
            name=DEMO_NAME,
            password_hash=hash_password(DEMO_PASSWORD),
            role="admin",
        )
        db.add(user)
        db.flush()
    project = db.get(Project, DEMO_PROJECT_ID)
    if project is None:
        db.add(
            Project(
                id=DEMO_PROJECT_ID,
                slug=DEMO_PROJECT_SLUG,
                name=DEMO_PROJECT_NAME,
                owner_id=DEMO_USER_ID,
            )
        )
        db.flush()
    if db.get(Environment, DEMO_ENV_PROD_ID) is None:
        db.add(Environment(id=DEMO_ENV_PROD_ID, project_id=DEMO_PROJECT_ID, name="prod"))
    if db.get(Environment, DEMO_ENV_STAGING_ID) is None:
        db.add(Environment(id=DEMO_ENV_STAGING_ID, project_id=DEMO_PROJECT_ID, name="staging"))
    if db.get(ApiKey, DEMO_API_KEY_ID) is None:
        db.add(
            ApiKey(
                id=DEMO_API_KEY_ID,
                project_id=DEMO_PROJECT_ID,
                name="sdk",
                key_prefix=DEMO_API_KEY_PREFIX,
                key_hash=hash_api_key(DEMO_API_KEY),
                demo_token=DEMO_API_KEY,
            )
        )


def _wipe(db) -> None:
    params = {"id": DEMO_PROJECT_ID}
    for statement in (
        "DELETE FROM alert_incidents WHERE project_id = :id",
        "DELETE FROM alert_rules WHERE project_id = :id",
        "DELETE FROM deploys WHERE project_id = :id",
        "DELETE FROM error_events WHERE project_id = :id",
        "DELETE FROM resource_metrics WHERE project_id = :id",
        "DELETE FROM request_metrics WHERE project_id = :id",
    ):
        db.execute(text(statement), params)


def _ensure_rules(db, end: datetime) -> None:
    if db.get(AlertRule, RULE_CHECKOUT_ID) is None:
        db.add(
            AlertRule(
                id=RULE_CHECKOUT_ID,
                project_id=DEMO_PROJECT_ID,
                environment="prod",
                name="Checkout p95",
                metric="p95_ms",
                operator="gt",
                threshold=800,
                window="10m",
                severity="critical",
                channels=["slack:#ops", "email:demo@pulseops.dev"],
                enabled=True,
                created_at=end - timedelta(days=2),
            )
        )
    if db.get(AlertRule, RULE_PAYMENTS_ID) is None:
        db.add(
            AlertRule(
                id=RULE_PAYMENTS_ID,
                project_id=DEMO_PROJECT_ID,
                environment="prod",
                name="Payments error rate",
                metric="error_pct",
                operator="gt",
                threshold=2,
                window="15m",
                severity="warning",
                channels=["slack:#ops"],
                enabled=True,
                created_at=end - timedelta(days=2),
            )
        )
    if db.get(AlertIncident, INCIDENT_CHECKOUT_ID) is None:
        db.add(
            AlertIncident(
                id=INCIDENT_CHECKOUT_ID,
                project_id=DEMO_PROJECT_ID,
                rule_id=RULE_CHECKOUT_ID,
                environment="prod",
                status="firing",
                severity="critical",
                title="Checkout p95 above 800ms",
                detail="POST /api/checkout p95 crossed 800 ms for 10 minutes on prod after v2.14.1.",
                started_at=end - timedelta(minutes=35),
            )
        )
    if db.get(AlertIncident, INCIDENT_PAYMENTS_ID) is None:
        db.add(
            AlertIncident(
                id=INCIDENT_PAYMENTS_ID,
                project_id=DEMO_PROJECT_ID,
                rule_id=RULE_PAYMENTS_ID,
                environment="prod",
                status="firing",
                severity="warning",
                title="Payments error rate elevated",
                detail="POST /api/payments 5xx rate is above 2% on prod.",
                started_at=end - timedelta(hours=2),
            )
        )


def _ensure_deploys(db, end: datetime) -> None:
    existing = db.execute(
        text("SELECT count(*) FROM deploys WHERE project_id = :id"),
        {"id": DEMO_PROJECT_ID},
    ).scalar_one()
    if existing:
        return
    plans = (
        ("prod", end - timedelta(hours=20), "v2.14.0", "a1b2c3d"),
        ("prod", end - timedelta(hours=6), "v2.14.1", "e4f5a6b"),
        ("staging", end - timedelta(hours=12), "v2.13.9", "0c0ffee"),
    )
    for env, when, version, sha in plans:
        for service in SERVICES:
            db.add(
                Deploy(
                    project_id=DEMO_PROJECT_ID,
                    env=env,
                    service=service,
                    version=version,
                    commit_sha=sha,
                    deployed_at=when,
                )
            )


def _ensure_errors(db, end: datetime) -> None:
    existing = db.execute(
        text("SELECT count(*) FROM error_events WHERE project_id = :id"),
        {"id": DEMO_PROJECT_ID},
    ).scalar_one()
    if existing:
        return
    rows = []
    minute = end - timedelta(hours=24)
    step = 0
    while minute <= end:
        if step % 20 == 0:
            rows.append(_error(minute, "prod", "payments", "fp_payments_upstream_timeout", "TimeoutError", "upstream timeout talking to payments.example.com", PAY_STACK, "POST /api/payments", {"host": "payments.example.com", "timeout_ms": 3000}))
        if minute >= end - timedelta(hours=2) and step % 2 == 0:
            rows.append(_error(minute, "prod", "payments", "fp_payments_upstream_timeout", "TimeoutError", "upstream timeout talking to payments.example.com", PAY_STACK, "POST /api/payments", {"host": "payments.example.com", "timeout_ms": 3000}))
        if step % 30 == 0:
            rows.append(_error(minute, "prod", "checkout", "fp_checkout_card_token", "ValidationError", "card token missing", CARD_STACK, "POST /api/checkout", {"field": "card_token"}))
        if step % 45 == 0:
            rows.append(_error(minute, "prod", "orders", "fp_orders_statement_timeout", "QueryCanceled", "canceling statement due to statement timeout", DB_STACK, "GET /api/orders/:id", {"statement_timeout_ms": 5000}))
        if step % 90 == 0:
            rows.append(_error(minute, "staging", "catalog", "fp_search_bad_query", "ValueError", "search query exceeded 256 characters", "ValueError: search query exceeded 256 characters\n    at search (catalog/routes.py:19)", "GET /api/search", {"limit": 256}))
        minute += timedelta(minutes=1)
        step += 1
    db.execute(
        text(
            """
            INSERT INTO error_events
                (time, project_id, env, service, fingerprint, type, message, stack, route, trace_id, context)
            VALUES
                (:time, :project_id, :env, :service, :fingerprint, :type, :message, :stack, :route, :trace_id, CAST(:context AS jsonb))
            """
        ),
        rows,
    )


def _error(when, env, service, fingerprint, kind, message, stack, route, context) -> dict:
    import json

    return {
        "time": when,
        "project_id": DEMO_PROJECT_ID,
        "env": env,
        "service": service,
        "fingerprint": fingerprint,
        "type": kind,
        "message": message,
        "stack": stack,
        "route": route,
        "trace_id": f"tr_{fingerprint[-6:]}_{int(when.timestamp())}",
        "context": json.dumps(context),
    }


def seed(force: bool = False) -> None:
    end = _aligned()
    start = end - timedelta(hours=24)
    deploy_at = end - timedelta(hours=6)
    payments_at = end - timedelta(hours=2)
    with SessionLocal() as db:
        _ensure_identity(db)
        if force:
            _wipe(db)
        db.commit()
        count = db.execute(
            text("SELECT count(*) FROM request_metrics WHERE project_id = :id"),
            {"id": DEMO_PROJECT_ID},
        ).scalar_one()
    if count == 0:
        requests = _copy(
            """
            COPY request_metrics (
                time, project_id, env, service, host, method, route,
                status_code, duration_ms, trace_id, version, weight
            ) FROM STDIN
            """,
            _iter_requests(start, end, deploy_at, payments_at),
        )
        resources = _copy(
            """
            COPY resource_metrics (
                time, project_id, env, service, host, cpu_pct, mem_rss_mb, heap_used_mb,
                disk_read_bps, disk_write_bps, net_in_bps, net_out_bps,
                event_loop_lag_ms, gc_pause_ms
            ) FROM STDIN
            """,
            _iter_resources(start, end, deploy_at),
        )
        print(f"seed: inserted {requests} request rows and {resources} resource rows")
        try:
            _refresh()
            print("seed: refreshed request_metrics_1m")
        except Exception as exc:
            print(f"seed: continuous aggregate refresh skipped: {exc}")
    with SessionLocal() as db:
        _ensure_rules(db, end)
        _ensure_deploys(db, end)
        _ensure_errors(db, end)
        db.commit()
    print(f"seed: {DEMO_EMAIL} / {DEMO_PASSWORD}  project {DEMO_PROJECT_SLUG}  api key {DEMO_API_KEY}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the PulseOps demo project")
    parser.add_argument("--force", action="store_true", help="Replace demo metrics, errors, and incidents")
    args = parser.parse_args()
    seed(force=args.force)


if __name__ == "__main__":
    main()
