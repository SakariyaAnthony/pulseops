from uuid import uuid4

from sqlalchemy import text

from app.constants import DEMO_API_KEY
from app.db import SessionLocal


def test_ingest_metrics_errors_and_events_return_202(client, auth):
    created = client.post(
        "/projects",
        json={"name": f"Ingest {uuid4().hex[:8]}"},
        headers=auth["headers"],
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["project"]["id"]
    slug = created.json()["project"]["slug"]
    headers = {"X-API-Key": created.json()["api_key"]["token"]}
    try:
        _assert_ingest_accepted(client, headers)
    finally:
        with SessionLocal() as db:
            for table in ("request_metrics", "resource_metrics", "error_events", "deploys"):
                db.execute(text(f"DELETE FROM {table} WHERE project_id = :id"), {"id": project_id})
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()


def _assert_ingest_accepted(client, headers):
    metrics = client.post(
        "/ingest/v1/metrics",
        headers=headers,
        json={
            "requests": [
                {
                    "env": "prod",
                    "service": "catalog",
                    "host": "shop-api-1",
                    "method": "GET",
                    "route": "/api/products",
                    "status_code": 200,
                    "duration_ms": 48.5,
                }
            ],
            "resources": [
                {
                    "env": "prod",
                    "service": "shop-api",
                    "host": "shop-api-1",
                    "cpu_pct": 33.5,
                    "mem_rss_mb": 710,
                }
            ],
        },
    )
    assert metrics.status_code == 202, metrics.text
    assert metrics.json() == {"accepted": 2}

    errors = client.post(
        "/ingest/v1/errors",
        headers=headers,
        json={
            "errors": [
                {
                    "fingerprint": "fp_ingest_test",
                    "type": "RuntimeError",
                    "message": "ingest test",
                    "service": "catalog",
                    "route": "GET /api/products",
                }
            ]
        },
    )
    assert errors.status_code == 202, errors.text
    assert errors.json()["accepted"] == 1

    events = client.post(
        "/ingest/v1/events",
        headers=headers,
        json={"events": [{"type": "deploy", "version": "v9.9.9", "service": "catalog", "env": "prod"}]},
    )
    assert events.status_code == 202, events.text
    assert events.json()["accepted"] == 1


def test_ingest_requires_api_key(client):
    missing = client.post("/ingest/v1/metrics", json={"requests": []})
    assert missing.status_code == 401
    rejected = client.post(
        "/ingest/v1/errors",
        headers={"X-API-Key": "not-a-real-key"},
        json={"errors": []},
    )
    assert rejected.status_code == 401


def test_ingest_rejects_invalid_payload(client):
    response = client.post(
        "/ingest/v1/metrics",
        headers={"X-API-Key": DEMO_API_KEY},
        json={"requests": [{"service": "catalog", "method": "GET", "route": "/", "status_code": 99, "duration_ms": 1}]},
    )
    assert response.status_code == 422
    events = client.post(
        "/ingest/v1/events",
        headers={"X-API-Key": DEMO_API_KEY},
        json={"events": [{"type": "deploy"}]},
    )
    assert events.status_code == 422
