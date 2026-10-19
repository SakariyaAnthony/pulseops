from uuid import uuid4

from sqlalchemy import text

from app.db import SessionLocal


def test_seeded_shop_has_a_finding(client, auth, project_id):
    response = client.get(
        f"/projects/{project_id}/insights",
        params={"range": "24h", "env": "prod"},
        headers=auth["headers"],
    )
    assert response.status_code == 200, response.text
    insights = response.json()["insights"]
    assert insights
    assert any(item["severity"] in {"warning", "critical"} for item in insights)
    assert any("href" in item and item["title"] for item in insights)
    joined = " ".join(item["title"] + item["body"] for item in insights).lower()
    assert "checkout" in joined or "payment" in joined or "error" in joined


def test_browser_page_and_error_show_up(client, auth):
    created = client.post(
        "/projects",
        json={"name": f"React {uuid4().hex[:8]}"},
        headers=auth["headers"],
    )
    assert created.status_code == 201, created.text
    project_id = created.json()["project"]["id"]
    slug = created.json()["project"]["slug"]
    key = created.json()["api_key"]["token"]
    ingest = {"X-API-Key": key}
    try:
        metrics = client.post(
            "/ingest/v1/metrics",
            headers=ingest,
            json={
                "requests": [
                    {
                        "env": "dev",
                        "service": "my-react-app",
                        "method": "GET",
                        "route": "page:/checkout",
                        "status_code": 200,
                        "duration_ms": 1400,
                    }
                ]
            },
        )
        assert metrics.status_code == 202, metrics.text
        for _ in range(2):
            errors = client.post(
                "/ingest/v1/errors",
                headers=ingest,
                json={
                    "errors": [
                        {
                            "env": "dev",
                            "service": "my-react-app",
                            "fingerprint": "js_checkout_render",
                            "type": "TypeError",
                            "message": "Cannot read properties of undefined",
                            "stack": "TypeError: Cannot read properties of undefined\n    at Checkout (Checkout.tsx:12)",
                            "route": "page:/checkout",
                        }
                    ]
                },
            )
            assert errors.status_code == 202, errors.text
        body = client.get(
            f"/projects/{slug}/insights",
            params={"range": "15m", "env": "dev"},
            headers=auth["headers"],
        )
        assert body.status_code == 200, body.text
        titles = " ".join(item["title"] for item in body.json()["insights"])
        assert "Slow page /checkout" in titles
        assert "Cannot read properties of undefined" in titles
    finally:
        with SessionLocal() as db:
            for table in ("request_metrics", "error_events"):
                db.execute(text(f"DELETE FROM {table} WHERE project_id = :id"), {"id": project_id})
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()
