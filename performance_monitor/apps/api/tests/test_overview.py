from urllib.parse import quote
from uuid import UUID

from app.constants import HIST_COLS


def test_overview_kpis(client, auth, project_id):
    response = client.get(
        f"/projects/{project_id}/overview",
        params={"range": "1h", "env": "prod"},
        headers=auth["headers"],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["slug"] == "shop-api"
    assert body["range"] == "1h"
    assert body["environment"] == "prod"
    kpis = body["kpis"]
    assert kpis["avg_ms"]["value"] > 0
    assert kpis["p95_ms"]["value"] >= kpis["avg_ms"]["value"]
    assert kpis["rpm"]["value"] > 1000
    assert kpis["rpm"]["delta_pct"] is not None
    assert 0 <= kpis["error_pct"]["value"] < 20
    assert 0.5 < kpis["apdex"]["value"] <= 1
    assert len(kpis["p95_ms"]["sparkline"]) >= 50
    assert body["response_time"]["metric"] == "response_time"
    p95 = next(series for series in body["response_time"]["series"] if series["name"] == "p95")
    assert isinstance(p95["points"][0][0], int)
    assert isinstance(p95["points"][0][1], float)
    assert isinstance(body["response_time"]["deploys"], list)
    names = {item["name"] for item in body["services"]}
    assert {"catalog", "checkout", "payments"} <= names
    assert body["slow_endpoints"]
    assert len(body["incidents"]) >= 2
    assert {item["status"] for item in body["incidents"]} == {"firing"}


def test_timeseries_contract(client, auth, project_id):
    response = client.get(
        f"/projects/{project_id}/metrics/timeseries",
        params={"metric": "response_time", "range": "24h", "env": "prod"},
        headers=auth["headers"],
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["metric"] == "response_time"
    assert body["resolution"] == "15m"
    assert [series["name"] for series in body["series"]] == ["p50", "p95", "p99"]
    assert body["series"][1]["points"]
    assert {"time", "version"} <= set(body["deploys"][0])
    versions = {item["version"] for item in body["deploys"]}
    assert "v2.14.1" in versions


def test_services_endpoints_resources_and_errors(client, auth, project_id):
    headers = auth["headers"]
    services = client.get(
        f"/projects/{project_id}/services",
        params={"range": "1h", "env": "prod"},
        headers=headers,
    )
    assert services.status_code == 200, services.text
    checkout = client.get(
        f"/projects/{project_id}/services/checkout",
        params={"range": "6h", "env": "prod"},
        headers=headers,
    )
    assert checkout.status_code == 200, checkout.text
    assert checkout.json()["name"] == "checkout"
    assert checkout.json()["p95_ms"] > 0

    endpoints = client.get(
        f"/projects/{project_id}/endpoints",
        params={"range": "1h", "env": "prod", "sort": "p95"},
        headers=headers,
    )
    assert endpoints.status_code == 200, endpoints.text
    assert endpoints.json()["total"] >= 10
    key = quote("GET /api/products", safe="")
    detail = client.get(
        f"/projects/{project_id}/endpoints/{key}",
        params={"range": "1h", "env": "prod"},
        headers=headers,
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["route"] == "/api/products"
    assert detail.json()["histogram"]
    assert detail.json()["status"]["2xx"] > 0

    resources = client.get(
        f"/projects/{project_id}/resources",
        params={"range": "1h", "env": "prod"},
        headers=headers,
    )
    assert resources.status_code == 200, resources.text
    assert "shop-api-1" in resources.json()["hosts"]
    assert resources.json()["latest"]["cpu_pct"] > 0
    assert resources.json()["metrics"]["cpu_pct"]["series"]

    errors = client.get(
        f"/projects/{project_id}/errors",
        params={"range": "24h", "env": "prod"},
        headers=headers,
    )
    assert errors.status_code == 200, errors.text
    groups = errors.json()["groups"]
    fingerprints = {item["fingerprint"] for item in groups}
    assert "fp_payments_upstream_timeout" in fingerprints
    detail = client.get(
        f"/projects/{project_id}/errors/fp_payments_upstream_timeout",
        params={"range": "24h", "env": "prod"},
        headers=headers,
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["stack"]
    assert detail.json()["events"]


def test_alert_rules_and_ack(client, auth, project_id):
    headers = auth["headers"]
    listed = client.get(f"/projects/{project_id}/alert-rules", headers=headers)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["rules"]) >= 2

    created = client.post(
        f"/projects/{project_id}/alert-rules",
        headers=headers,
        json={
            "name": "CPU hot",
            "metric": "cpu_pct",
            "operator": "gt",
            "threshold": 85,
            "window": "5m",
            "severity": "warning",
            "channels": ["slack:#ops"],
            "environment": "prod",
        },
    )
    assert created.status_code == 201, created.text
    rule_id = created.json()["id"]
    patched = client.patch(
        f"/projects/{project_id}/alert-rules/{rule_id}",
        headers=headers,
        json={"enabled": False},
    )
    assert patched.status_code == 200
    assert patched.json()["enabled"] is False
    deleted = client.delete(f"/projects/{project_id}/alert-rules/{rule_id}", headers=headers)
    assert deleted.status_code == 204

    incidents = client.get("/incidents", params={"project_id": project_id, "status": "firing"}, headers=headers)
    assert incidents.status_code == 200, incidents.text
    incident_id = incidents.json()["incidents"][0]["id"]
    try:
        acked = client.post(
            f"/incidents/{incident_id}/ack",
            headers=headers,
            json={"note": "looking"},
        )
        assert acked.status_code == 200, acked.text
        assert acked.json()["status"] == "acknowledged"
        assert acked.json()["ack_note"] == "looking"
    finally:
        from app.db import SessionLocal
        from app.models import AlertIncident

        with SessionLocal() as db:
            row = db.get(AlertIncident, UUID(incident_id))
            row.status = "firing"
            row.acked_at = None
            row.ack_note = None
            db.commit()


def test_websocket_snapshot_and_alert(client, auth, project_id):
    with client.websocket_connect(f"/ws?project_id={project_id}&token={auth['token']}") as ws:
        snapshot = ws.receive_json()
        alert = ws.receive_json()
    assert snapshot["event"] == "metrics.snapshot"
    assert snapshot["data"]["project_id"] == project_id
    assert "p95_ms" in snapshot["data"]
    assert alert["event"] == "alert.triggered"
    assert alert["data"]["status"] == "firing"


def test_rollup_view_has_histogram(client):
    from sqlalchemy import text

    from app.db import engine

    with engine.connect() as conn:
        columns = conn.execute(
            text(
                """
                SELECT attname FROM pg_attribute
                WHERE attrelid = 'request_metrics_1m'::regclass
                  AND attnum > 0
                  AND NOT attisdropped
                """
            )
        ).scalars().all()
    for column in ("bucket", "calls", "sum_ms", *HIST_COLS):
        assert column in columns


def test_healthz(client):
    response = client.get("/healthz")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"] is True
    assert body["redis"] is True
