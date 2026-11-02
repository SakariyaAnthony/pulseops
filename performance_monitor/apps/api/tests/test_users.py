from uuid import uuid4

import pytest
from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal


@pytest.fixture(autouse=True)
def _no_signup_throttle(monkeypatch):
    monkeypatch.setattr(settings, "register_limit_per_hour", 100000)


def test_signup_is_throttled_per_address(client, monkeypatch):
    from app.redis_bus import _client

    try:
        _client().ping()
    except Exception:
        pytest.skip("Redis is not running, so there is no throttle to test")
    monkeypatch.setattr(settings, "register_limit_per_hour", 1)
    emails = [f"throttle-{uuid4().hex[:8]}@example.com" for _ in range(3)]
    try:
        statuses = [_register(client, email).status_code for email in emails]
        assert 429 in statuses
    finally:
        _delete(*emails)
        _client().delete(*_client().keys("pulseops:win:register:*"))


def _delete(*emails: str) -> None:
    with SessionLocal() as db:
        for email in emails:
            db.execute(text("DELETE FROM users WHERE email = :email"), {"email": email})
        db.commit()


def _register(client, email: str, name: str = "New Person", password: str = "correct-horse"):
    return client.post("/auth/register", json={"name": name, "email": email, "password": password})


def test_register_signs_the_new_member_in_with_no_projects(client):
    email = f"member-{uuid4().hex[:8]}@example.com"
    try:
        created = _register(client, email.upper(), name="  New   Person ")
        assert created.status_code == 201, created.text
        body = created.json()
        assert body["user"]["email"] == email
        assert body["user"]["name"] == "New Person"
        assert body["user"]["role"] == "member"
        assert "password" not in str(body["user"]).lower()
        headers = {"Authorization": f"Bearer {body['access_token']}"}
        assert client.get("/auth/me", headers=headers).json()["email"] == email
        assert client.get("/projects", headers=headers).json()["projects"] == []
        # A member cannot see the user table.
        assert client.get("/users", headers=headers).status_code == 403
        assert client.post("/auth/login", json={"email": email, "password": "correct-horse"}).status_code == 200
        assert client.post("/auth/login", json={"email": email, "password": "wrong-password"}).status_code == 401
    finally:
        _delete(email)


def test_register_rejects_duplicates_and_bad_input(client):
    email = f"dupe-{uuid4().hex[:8]}@example.com"
    try:
        assert _register(client, email).status_code == 201
        again = _register(client, email.upper())
        assert again.status_code == 409
        assert "already exists" in again.json()["detail"]
        assert _register(client, "demo@pulseops.dev").status_code == 409
        assert _register(client, f"short-{uuid4().hex[:6]}@example.com", password="short").status_code == 422
        assert _register(client, "not-an-email").status_code == 422
        assert _register(client, f"blank-{uuid4().hex[:6]}@example.com", name="   ").status_code == 422
    finally:
        _delete(email)


def test_register_can_be_turned_off(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_registration", False)
    response = _register(client, f"off-{uuid4().hex[:8]}@example.com")
    assert response.status_code == 403


def test_admin_manages_the_user_table(client, auth):
    email = f"managed-{uuid4().hex[:8]}@example.com"
    try:
        created = _register(client, email).json()
        user_id = created["user"]["id"]
        member = {"Authorization": f"Bearer {created['access_token']}"}

        listing = client.get("/users", params={"search": email.split("@")[0]}, headers=auth["headers"])
        assert listing.status_code == 200, listing.text
        rows = listing.json()["users"]
        assert [row["email"] for row in rows] == [email]
        assert rows[0]["project_count"] == 0 and rows[0]["is_active"] is True
        assert listing.json()["totals"]["all"] >= 2

        promoted = client.patch(f"/users/{user_id}", json={"role": "admin"}, headers=auth["headers"])
        assert promoted.status_code == 200 and promoted.json()["role"] == "admin"
        assert client.get("/users", headers=member).status_code == 200
        client.patch(f"/users/{user_id}", json={"role": "member"}, headers=auth["headers"])

        disabled = client.patch(f"/users/{user_id}", json={"is_active": False}, headers=auth["headers"])
        assert disabled.status_code == 200 and disabled.json()["is_active"] is False
        assert client.post("/auth/login", json={"email": email, "password": "correct-horse"}).status_code == 403
        assert client.get("/auth/me", headers=member).status_code == 401
        only_disabled = client.get("/users", params={"status": "disabled"}, headers=auth["headers"]).json()["users"]
        assert email in [row["email"] for row in only_disabled]

        client.patch(f"/users/{user_id}", json={"is_active": True}, headers=auth["headers"])
        assert client.get("/auth/me", headers=member).status_code == 200
    finally:
        _delete(email)


def test_admin_cannot_lock_themselves_out(client, auth):
    me = client.get("/auth/me", headers=auth["headers"]).json()
    assert me["role"] == "admin"
    own_role = client.patch(f"/users/{me['id']}", json={"role": "member"}, headers=auth["headers"])
    assert own_role.status_code == 409
    own_disable = client.patch(f"/users/{me['id']}", json={"is_active": False}, headers=auth["headers"])
    assert own_disable.status_code == 409
    assert client.patch(f"/users/{uuid4()}", json={"role": "member"}, headers=auth["headers"]).status_code == 404
    assert client.patch(f"/users/{me['id']}", json={"role": "owner"}, headers=auth["headers"]).status_code == 422


def test_last_admin_is_protected(client, auth):
    email = f"second-{uuid4().hex[:8]}@example.com"
    try:
        created = _register(client, email).json()
        user_id = created["user"]["id"]
        client.patch(f"/users/{user_id}", json={"role": "admin"}, headers=auth["headers"])
        # Two admins: the new one may step down. The demo admin remains.
        second = {"Authorization": f"Bearer {created['access_token']}"}
        demo_id = client.get("/auth/me", headers=auth["headers"]).json()["id"]
        assert client.patch(f"/users/{demo_id}", json={"role": "member"}, headers=second).status_code == 200
        # The demo user is now a plain member and the second user is the only admin.
        guard = client.patch(f"/users/{user_id}", json={"is_active": False}, headers=second)
        assert guard.status_code == 409
        client.patch(f"/users/{demo_id}", json={"role": "admin"}, headers=second)
    finally:
        _delete(email)


def test_profile_can_be_read_renamed_and_password_changed(client):
    email = f"profile-{uuid4().hex[:8]}@example.com"
    try:
        created = _register(client, email).json()
        headers = {"Authorization": f"Bearer {created['access_token']}"}
        profile = client.get("/auth/me", headers=headers).json()
        assert profile["project_count"] == 0 and profile["created_at"] and profile["last_login_at"]

        renamed = client.patch("/auth/me", json={"name": "  Grace   Hopper "}, headers=headers)
        assert renamed.status_code == 200 and renamed.json()["name"] == "Grace Hopper"
        assert client.patch("/auth/me", json={"name": "   "}, headers=headers).status_code == 422

        wrong = client.post("/auth/password", json={"current_password": "nope-nope", "new_password": "another-pass-1"}, headers=headers)
        assert wrong.status_code == 403
        weak = client.post("/auth/password", json={"current_password": "correct-horse", "new_password": "short"}, headers=headers)
        assert weak.status_code == 422
        same = client.post("/auth/password", json={"current_password": "correct-horse", "new_password": "correct-horse"}, headers=headers)
        assert same.status_code == 422
        changed = client.post("/auth/password", json={"current_password": "correct-horse", "new_password": "another-pass-1"}, headers=headers)
        assert changed.status_code == 200
        assert client.post("/auth/login", json={"email": email, "password": "correct-horse"}).status_code == 401
        assert client.post("/auth/login", json={"email": email, "password": "another-pass-1"}).status_code == 200
        assert client.post("/auth/password", json={"current_password": "x", "new_password": "another-pass-2"}).status_code == 401
    finally:
        _delete(email)
