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
        assert endpoint["avg_ms"] is None
        assert endpoint["apdex"] == 0
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


def test_create_project_with_scan_config_is_all_or_nothing(client, auth, tmp_path: Path):
    allowed = tmp_path / "Youtube-Clone"
    allowed.mkdir()
    (allowed / "package.json").write_text('{"dependencies":{"react":"18.0.0"},"devDependencies":{"vite":"6.0.0"}}', encoding="utf-8")
    settings.scan_roots = str(tmp_path)
    token = uuid4().hex[:8]
    name = f"Clone {token}"
    bad_name = f"Bad {token}"
    try:
        created = client.post(
            "/projects",
            json={
                "name": name,
                "scan_config": {
                    "repository_path": str(allowed),
                    "base_url": "http://localhost:3000",
                    "routes": ["/", "/watch"],
                },
            },
            headers=auth["headers"],
        )
        assert created.status_code == 201, created.text
        project = created.json()["project"]
        assert project["repository_path"] == str(allowed)
        assert project["base_url"] == "http://localhost:3000"
        assert project["framework"] == "react-vite"
        assert project["scan_config"]["routes"] == ["/", "/watch"]

        rejected = client.post(
            "/projects",
            json={"name": bad_name, "scan_config": {"repository_path": "/etc", "routes": ["/"]}},
            headers=auth["headers"],
        )
        assert rejected.status_code == 422
        listed = client.get("/projects", headers=auth["headers"]).json()["projects"]
        assert all(item["name"] != bad_name for item in listed)
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM projects WHERE name IN (:name, :bad)"), {"name": name, "bad": bad_name})
            db.commit()


def test_delete_project_removes_its_data_and_refuses_while_scanning(client, auth):
    made = client.post("/projects", json={"name": f"Delete me {uuid4().hex[:6]}"}, headers=auth["headers"]).json()
    slug, key = made["project"]["slug"], made["api_key"]["token"]
    point = {"env": "dev", "service": "s", "method": "GET", "route": "/a", "status_code": 200, "duration_ms": 5}
    assert client.post("/ingest/v1/metrics", json={"requests": [point]}, headers={"X-API-Key": key}).status_code == 202
    with SessionLocal() as db:
        db.execute(
            text(
                "INSERT INTO scan_runs (id, project_id, status, mode, progress, config_json, created_at) "
                "SELECT gen_random_uuid(), id, 'running', 'static', '{}', '{}', now() FROM projects WHERE slug = :slug"
            ),
            {"slug": slug},
        )
        db.commit()
    assert client.delete(f"/projects/{slug}", headers=auth["headers"]).status_code == 409
    with SessionLocal() as db:
        db.execute(text("UPDATE scan_runs SET status = 'completed' WHERE project_id = (SELECT id FROM projects WHERE slug = :slug)"), {"slug": slug})
        db.commit()
    assert client.delete(f"/projects/{slug}", headers=auth["headers"]).status_code == 204
    assert client.get(f"/projects/{slug}", headers=auth["headers"]).status_code == 404
    with SessionLocal() as db:
        assert db.execute(text("SELECT count(*) FROM request_metrics WHERE route = '/a' AND service = 's' AND project_id NOT IN (SELECT id FROM projects)")).scalar() == 0


def test_rotate_key_revokes_the_old_key_and_returns_a_working_one(client, auth):
    made = client.post("/projects", json={"name": f"Rotate me {uuid4().hex[:6]}"}, headers=auth["headers"]).json()
    slug, old = made["project"]["slug"], made["api_key"]["token"]
    point = {"env": "dev", "service": "s", "method": "GET", "route": "/a", "status_code": 200, "duration_ms": 5}
    assert client.post("/ingest/v1/metrics", json={"requests": [point]}, headers={"X-API-Key": old}).status_code == 202
    rotated = client.post(f"/projects/{slug}/api-key", headers=auth["headers"])
    assert rotated.status_code == 201, rotated.text
    new = rotated.json()["api_key"]["token"]
    assert new != old and new.startswith("po_live_")
    assert client.post("/ingest/v1/metrics", json={"requests": [point]}, headers={"X-API-Key": old}).status_code == 401
    assert client.post("/ingest/v1/metrics", json={"requests": [point]}, headers={"X-API-Key": new}).status_code == 202


def test_create_project_rejects_a_duplicate_name(client, auth):
    name = f"Dup {uuid4().hex[:6]}"
    assert client.post("/projects", json={"name": name}, headers=auth["headers"]).status_code == 201
    again = client.post("/projects", json={"name": name.upper()}, headers=auth["headers"])
    assert again.status_code == 409
    assert "already exists" in again.json()["detail"]


def _view(route, device, nav_type, lcp, inp, cls, page_view_id):
    base = {"env": "prod", "service": "web", "route": route, "nav_type": nav_type, "device": device, "page_view_id": page_view_id}
    vitals = [
        {**base, "metric": "LCP", "value": lcp},
        {**base, "metric": "INP", "value": inp},
        {**base, "metric": "CLS", "value": cls},
    ]
    load = {**base, "ttfb_ms": 300, "load_ms": lcp, "transfer_bytes": 900000, "resource_count": 20}
    load.pop("page_view_id")
    return vitals, load


def test_field_vitals_and_lab_audit_stay_separate(client, auth, monkeypatch, tmp_path: Path):
    settings.scan_roots = str(tmp_path)
    token = uuid4().hex[:8]
    created = client.post(
        "/projects",
        json={"name": f"Vitals {token}", "scan_config": {"base_url": "http://127.0.0.1:5173", "routes": ["/"]}},
        headers=auth["headers"],
    )
    assert created.status_code == 201, created.text
    slug = created.json()["project"]["slug"]
    key = created.json()["api_key"]["token"]
    try:
        vitals, loads = [], []
        for index in range(25):
            v, load = _view("/orders?token=secret", "mobile", "first_load", 4800, 350, 0.3, f"m{index}")
            vitals += v
            loads.append(load)
        for index in range(5):
            v, load = _view("/rare", "desktop", "first_load", 9000, 900, 0.5, f"r{index}")
            vitals += v
            loads.append(load)
        sent = client.post("/ingest/v1/vitals", json={"vitals": vitals, "loads": loads}, headers={"X-API-Key": key})
        assert sent.status_code == 202, sent.text
        assert client.post("/ingest/v1/vitals", json={"vitals": [], "loads": []}).status_code in (401, 403)
        bogus = client.post(
            "/ingest/v1/vitals",
            json={"vitals": [{"service": "web", "route": "/x", "metric": "NOPE", "value": 1}]},
            headers={"X-API-Key": key},
        )
        assert bogus.status_code == 422

        window = "range=1h&env=prod"
        routes = client.get(f"/projects/{slug}/vitals/routes?{window}", headers=auth["headers"]).json()["routes"]
        by_route = {item["route"]: item for item in routes}
        assert "/orders" in by_route and not any("token" in item["route"] for item in routes)
        orders = by_route["/orders"]
        assert orders["enough_data"] is True
        assert orders["metrics"]["LCP"]["p75"] == 4800 and orders["metrics"]["LCP"]["rating"] == "poor"
        assert orders["metrics"]["CLS"]["rating"] == "poor"
        # Five views are too few for a percentile, so none is returned.
        assert by_route["/rare"]["metrics"]["LCP"]["p75"] is None

        desktop = client.get(f"/projects/{slug}/vitals/summary?{window}&device=desktop", headers=auth["headers"]).json()
        assert next(item for item in desktop["metrics"] if item["metric"] == "LCP")["p75"] is None

        # No lab audit yet. Field data must not fill in for it.
        detail = client.get(f"/projects/{slug}/vitals/detail?{window}&route=/orders", headers=auth["headers"]).json()
        assert detail["lab"]["pages"] == []
        assert client.get(f"/projects/{slug}/vitals/lab", headers=auth["headers"]).json() == {"scan": None, "pages": []}

        from app.scan.lighthouse import parse_report

        report = {
            "categories": {"performance": {"score": 0.5}},
            "audits": {
                "largest-contentful-paint": {"numericValue": 5000},
                "cumulative-layout-shift": {"numericValue": 0.02},
                "total-blocking-time": {"numericValue": 700},
                "network-requests": {"details": {"items": [{"url": "http://app/a.js", "resourceType": "Script", "transferSize": 5000}]}},
                "long-tasks": {"details": {"items": [{"url": "http://app/a.js", "duration": 800, "startTime": 10}]}},
            },
        }

        def fake_lighthouse(base_url, audit_routes, timeout_ms, should_cancel, progress):
            assert base_url == "http://127.0.0.1:5173" and audit_routes == ["/"]
            return [parse_report(report, "/", "mobile"), parse_report(report, "/", "desktop")]

        monkeypatch.setattr("app.scan.worker.collect_lighthouse", fake_lighthouse)
        started = client.post(f"/projects/{slug}/scans", json={"mode": "vitals"}, headers=auth["headers"])
        assert started.status_code == 201, started.text
        assert started.json()["status"] == "completed"
        lab = client.get(f"/projects/{slug}/vitals/lab", headers=auth["headers"]).json()
        assert {page["form_factor"] for page in lab["pages"]} == {"mobile", "desktop"}
        assert all(page["inp_ms"] is None and page["metric_source"] == "lab" for page in lab["pages"])
        assert any(item["id"] == "long_js_task" for item in lab["pages"][0]["diagnosis"])

        # Field numbers are unchanged by the lab run.
        after = client.get(f"/projects/{slug}/vitals/routes?{window}", headers=auth["headers"]).json()["routes"]
        assert next(item for item in after if item["route"] == "/orders")["metrics"]["LCP"]["p75"] == 4800
        lab_detail = client.get(f"/projects/{slug}/vitals/detail?{window}&route=/", headers=auth["headers"]).json()
        assert len(lab_detail["lab"]["pages"]) == 2 and lab_detail["field"]["summary"]["page_views"] == 0
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()
