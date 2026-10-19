def test_login_and_me_projects(client):
    response = client.post(
        "/auth/login",
        json={"email": "demo@pulseops.dev", "password": "pulseops-demo"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0
    assert body["user"]["email"] == "demo@pulseops.dev"
    assert body["access_token"]
    assert body["refresh_token"]

    projects = client.get("/projects", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert projects.status_code == 200
    slugs = [item["slug"] for item in projects.json()["projects"]]
    assert "shop-api" in slugs


def test_login_rejects_bad_password(client):
    response = client.post(
        "/auth/login",
        json={"email": "demo@pulseops.dev", "password": "nope"},
    )
    assert response.status_code == 401


def test_protected_route_requires_bearer(client):
    response = client.get("/projects")
    assert response.status_code == 401


def test_refresh_rotates_and_rejects_reuse(client):
    login = client.post(
        "/auth/login",
        json={"email": "Demo@pulseops.dev", "password": "pulseops-demo"},
    )
    assert login.status_code == 200, login.text
    refresh_token = login.json()["refresh_token"]
    refreshed = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert refreshed.status_code == 200, refreshed.text
    access = refreshed.json()["access_token"]
    assert access
    projects = client.get("/projects", headers={"Authorization": f"Bearer {access}"})
    assert projects.status_code == 200

    reused = client.post("/auth/refresh", json={"refresh_token": refresh_token})
    assert reused.status_code == 401

    wrong_type = client.post("/auth/refresh", json={"refresh_token": access})
    assert wrong_type.status_code == 401


def test_create_project_issues_api_key(client, auth):
    from uuid import uuid4

    from sqlalchemy import text

    from app.db import SessionLocal

    token = uuid4().hex[:8]
    created = client.post("/projects", json={"name": f"Billing {token}"}, headers=auth["headers"])
    assert created.status_code == 201, created.text
    body = created.json()
    slug = body["project"]["slug"]
    try:
        assert slug == f"billing-{token}"
        assert body["api_key"]["token"].startswith("po_live_")
        assert {item["name"] for item in body["project"]["environments"]} == {"prod", "staging"}
        listed = client.get(f"/projects/{slug}", headers=auth["headers"])
        assert listed.status_code == 200
        assert all(item["demo_token"] is None for item in listed.json()["api_keys"])
    finally:
        with SessionLocal() as db:
            db.execute(text("DELETE FROM projects WHERE slug = :slug"), {"slug": slug})
            db.commit()
