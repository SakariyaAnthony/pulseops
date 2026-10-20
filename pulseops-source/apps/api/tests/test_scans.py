from pathlib import Path
from uuid import uuid4

from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal
from app.scan.stats import observation_record
from app.scan.worker import run_scan


def _count_requests(project_id: str) -> int:
    with SessionLocal() as db:
        return int(
            db.execute(
                text("SELECT count(*) FROM request_metrics WHERE project_id = :project_id"),
                {"project_id": project_id},
            ).scalar_one()
        )


def test_static_scan_does_not_write_live_metrics(client, auth, tmp_path: Path):
    allowed = tmp_path / "app"
    source = allowed / "src"
    source.mkdir(parents=True)
    (source / "App.tsx").write_text('import logo from "./logo.svg";\n', encoding="utf-8")
    (source / "logo.svg").write_bytes(b"<svg></svg>")
    (source / "unused.png").write_bytes(b"png")
    (allowed / "package.json").write_text('{"dependencies":{"react":"18.0.0"},"devDependencies":{"vite":"6.0.0"}}', encoding="utf-8")
    settings.scan_roots = str(tmp_path)
    token = uuid4().hex[:8]
    created = client.post("/projects", json={"name": f"Scan {token}"}, headers=auth["headers"])
    assert created.status_code == 201, created.text
    slug = created.json()["project"]["slug"]
    project_id = created.json()["project"]["id"]
    try:
        outside = client.patch(
            f"/projects/{slug}/scan-config",
            json={"repository_path": "/etc", "routes": ["/"]},
            headers=auth["headers"],
        )
        assert outside.status_code == 422
        saved = client.patch(
            f"/projects/{slug}/scan-config",
            json={"repository_path": str(allowed), "base_url": "http://127.0.0.1:5173", "routes": ["/"]},
            headers=auth["headers"],
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["framework"] == "react-vite"
        before = _count_requests(project_id)
        started = client.post(f"/projects/{slug}/scans", json={"mode": "static"}, headers=auth["headers"])
        assert started.status_code == 201, started.text
        body = started.json()
        assert body["status"] == "completed"
        assert _count_requests(project_id) == before
        assets = client.get(f"/scans/{body['id']}/assets", headers=auth["headers"])
        assert assets.status_code == 200, assets.text
        rows = {item["file_path"]: item for item in assets.json()["assets"]}
        assert rows["src/logo.svg"]["classification"] is None
        assert "Referenced in source" in rows["src/logo.svg"]["explanation"]
        assert rows["src/unused.png"]["classification"] == "duplicate_candidate" or rows["src/unused.png"]["classification"] == "potentially_unused"
        assert "not proof" in rows["src/unused.png"]["explanation"]
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()


def test_browser_scan_stores_failures_without_touching_live_metrics(client, auth, monkeypatch, tmp_path: Path):
    allowed = tmp_path / "app"
    allowed.mkdir()
    (allowed / "hero.png").write_bytes(b"hero")
    settings.scan_roots = str(tmp_path)

    def fake_collect(base_url, routes, viewport, timeout_ms, should_cancel):
        assert base_url.startswith("http://127.0.0.1")
        assert routes == ["/checkout"]
        assert should_cancel() is False
        return {
            "pages": [
                {
                    "route": "/checkout",
                    "viewport_json": viewport,
                    "metric_source": "lab",
                    "lcp_ms": None,
                    "inp_ms": None,
                    "cls": None,
                    "total_transfer_bytes": None,
                    "duration_ms": None,
                    "sample_count": 1,
                    "status": "timeout",
                    "error_summary": "Timeout",
                }
            ],
            "observations": [
                observation_record(
                    route="/checkout",
                    method="GET",
                    url_path="/api/orders/15",
                    status_code=None,
                    duration_ms=None,
                    transfer_bytes=None,
                    failure_type="timeout",
                    resource_type="fetch",
                )
            ],
            "assets": [
                observation_record(
                    route="/checkout",
                    method="GET",
                    url_path="/hero.png",
                    status_code=None,
                    duration_ms=40,
                    transfer_bytes=1200,
                    failure_type="timeout",
                    resource_type="image",
                ),
                observation_record(
                    route="/checkout",
                    method="GET",
                    url_path="/media/banner.jpg",
                    status_code=404,
                    duration_ms=12,
                    transfer_bytes=None,
                    failure_type="http_error",
                    resource_type="image",
                ),
            ],
        }

    monkeypatch.setattr("app.scan.worker.collect_routes", fake_collect)
    token = uuid4().hex[:8]
    created = client.post("/projects", json={"name": f"Browser {token}"}, headers=auth["headers"])
    slug = created.json()["project"]["slug"]
    project_id = created.json()["project"]["id"]
    try:
        saved = client.patch(
            f"/projects/{slug}/scan-config",
            json={
                "repository_path": str(allowed),
                "base_url": "http://127.0.0.1:5173",
                "routes": ["/checkout"],
            },
            headers=auth["headers"],
        )
        assert saved.status_code == 200, saved.text
        before = _count_requests(project_id)
        started = client.post(f"/projects/{slug}/scans", json={"mode": "full"}, headers=auth["headers"])
        assert started.status_code == 201, started.text
        scan_id = started.json()["id"]
        assert started.json()["status"] == "failed"
        assert _count_requests(project_id) == before
        apis = client.get(f"/scans/{scan_id}/apis", headers=auth["headers"])
        assert apis.status_code == 200, apis.text
        endpoint = apis.json()["endpoints"][0]
        assert endpoint["endpoint_template"] == "/api/orders/{id}"
        assert endpoint["sample_count"] == 0
        assert endpoint["p95_ms"] is None
        assert endpoint["error_rate"] == 1
        dumped = apis.text.lower()
        assert "authorization" not in dumped
        assert "cookie" not in dumped
        assets = client.get(f"/scans/{scan_id}/assets", headers=auth["headers"])
        assert assets.status_code == 200, assets.text
        loads = assets.json()["summary"]["load_performance"]
        assert loads[0]["file_path"] == "hero.png"
        assert loads[0]["failure_type"] == "timeout"
        failed = {row["file_path"]: row for row in assets.json()["summary"]["insights"]["failed"]}
        assert set(failed) == {"hero.png", "media/banner.jpg"}
        assert failed["media/banner.jpg"]["status_code"] == 404
        assert failed["media/banner.jpg"]["in_repository"] is False
        assert failed["hero.png"]["in_repository"] is True
        pages = client.get(f"/scans/{scan_id}/pages", headers=auth["headers"])
        assert pages.json()["pages"][0]["metric_source"] == "lab"
        assert pages.json()["pages"][0]["lcp_ms"] is None
        assert pages.json()["pages"][0]["status"] == "timeout"
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()


def test_cancel_stops_a_queued_scan(client, auth):
    token = uuid4().hex[:8]
    created = client.post("/projects", json={"name": f"Cancel {token}"}, headers=auth["headers"])
    slug = created.json()["project"]["slug"]
    project_id = created.json()["project"]["id"]
    try:
        with SessionLocal() as db:
            db.execute(
                text(
                    """
                    INSERT INTO scan_runs (id, project_id, status, mode, progress, config_json, created_at)
                    VALUES (:id, :project_id, 'queued', 'static', '{}'::jsonb, '{}'::jsonb, now())
                    """
                ),
                {"id": "11111111-1111-1111-1111-111111111111", "project_id": project_id},
            )
            db.commit()
        cancelled = client.post("/scans/11111111-1111-1111-1111-111111111111/cancel", headers=auth["headers"])
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled"
        run_scan("11111111-1111-1111-1111-111111111111")
        again = client.get("/scans/11111111-1111-1111-1111-111111111111", headers=auth["headers"])
        assert again.json()["status"] == "cancelled"
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()
