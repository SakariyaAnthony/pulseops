import json
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

from app.config import settings
from app.db import SessionLocal
from app.models import AlertIncident, Project, PushSubscription

ENDPOINT = "https://push.example.test/send/"


@pytest.fixture(autouse=True)
def _push_on(monkeypatch):
    monkeypatch.setattr(settings, "vapid_public_key", "test-public-key")
    monkeypatch.setattr(settings, "vapid_private_key", "test-private-key")
    monkeypatch.setattr(settings, "register_limit_per_hour", 100000)


@pytest.fixture()
def owned(client, auth):
    """A throwaway project with one p95 rule, owned by the demo user."""
    created = client.post("/projects", json={"name": f"Push {uuid4().hex[:8]}"}, headers=auth["headers"])
    assert created.status_code == 201, created.text
    project = created.json()["project"]
    rule = client.post(
        f"/projects/{project['id']}/alert-rules",
        headers=auth["headers"],
        json={
            "name": "Checkout p95",
            "metric": "p95 latency",
            "operator": "gt",
            "threshold": 300,
            "window": "5m",
            "severity": "critical",
            "environment": "prod",
        },
    )
    assert rule.status_code == 201, rule.text
    yield {"project": project, "rule_id": rule.json()["id"]}
    with SessionLocal() as db:
        db.execute(text("DELETE FROM alert_incidents WHERE project_id = :id"), {"id": project["id"]})
        db.execute(text("DELETE FROM alert_rules WHERE project_id = :id"), {"id": project["id"]})
        db.execute(text("DELETE FROM api_keys WHERE project_id = :id"), {"id": project["id"]})
        db.execute(text("DELETE FROM environments WHERE project_id = :id"), {"id": project["id"]})
        db.execute(text("DELETE FROM projects WHERE id = :id"), {"id": project["id"]})
        db.commit()


@pytest.fixture()
def clean_subscriptions():
    yield
    with SessionLocal() as db:
        db.execute(text("DELETE FROM push_subscriptions WHERE endpoint LIKE :prefix"), {"prefix": f"{ENDPOINT}%"})
        db.commit()


def _subscribe(client, headers, endpoint, severities=None):
    body = {"endpoint": endpoint, "keys": {"p256dh": "p256dh-key", "auth": "auth-secret"}}
    if severities is not None:
        body["severities"] = severities
    return client.post("/push/subscriptions", json=body, headers=headers)


def _member(client):
    email = f"push-{uuid4().hex[:8]}@example.com"
    created = client.post("/auth/register", json={"name": "Push Member", "email": email, "password": "correct-horse"})
    assert created.status_code == 201, created.text
    return email, {"Authorization": f"Bearer {created.json()['access_token']}"}


def _delete_user(email):
    with SessionLocal() as db:
        db.execute(text("DELETE FROM users WHERE email = :email"), {"email": email})
        db.commit()


def test_vapid_key_reports_whether_push_is_configured(client, monkeypatch):
    assert client.get("/push/vapid-key").json() == {"enabled": True, "public_key": "test-public-key"}
    monkeypatch.setattr(settings, "vapid_private_key", "")
    assert client.get("/push/vapid-key").json()["enabled"] is False


def test_subscription_lifecycle_is_scoped_to_the_user(client, auth, clean_subscriptions):
    endpoint = f"{ENDPOINT}{uuid4().hex}"
    first = _subscribe(client, auth["headers"], endpoint)
    assert first.status_code == 201, first.text
    assert first.json()["severities"] == ["critical", "warning", "info"]
    again = _subscribe(client, auth["headers"], endpoint, ["critical", "critical"])
    assert again.json()["id"] == first.json()["id"]
    assert again.json()["severities"] == ["critical"]

    email, member = _member(client)
    try:
        sub_id = first.json()["id"]
        hidden = client.patch(f"/push/subscriptions/{sub_id}", json={"severities": ["info"]}, headers=member)
        assert hidden.status_code == 404
        assert client.get("/push/subscriptions", headers=member).json()["subscriptions"] == []
    finally:
        _delete_user(email)

    patched = client.patch(f"/push/subscriptions/{sub_id}", json={"severities": ["warning"]}, headers=auth["headers"])
    assert patched.status_code == 200 and patched.json()["severities"] == ["warning"]
    assert client.request("DELETE", "/push/subscriptions", json={"endpoint": endpoint}, headers=auth["headers"]).status_code == 204
    listed = client.get("/push/subscriptions", headers=auth["headers"]).json()["subscriptions"]
    assert endpoint not in [item["endpoint"] for item in listed]


def test_subscribing_needs_vapid_keys_and_https(client, auth, monkeypatch):
    assert _subscribe(client, auth["headers"], "http://insecure.example/x").status_code == 422
    monkeypatch.setattr(settings, "vapid_private_key", "")
    assert _subscribe(client, auth["headers"], f"{ENDPOINT}{uuid4().hex}").status_code == 503


def test_evaluator_opens_one_incident_per_breach(owned, monkeypatch):
    from app import alerting

    published, pushed = [], []
    monkeypatch.setattr(alerting, "publish", lambda pid, payload: published.append(payload))
    monkeypatch.setattr(alerting, "notify_incident", lambda db, incident: pushed.append(incident.id))
    project_id = UUID(owned["project"]["id"])
    with SessionLocal() as db:
        assert alerting.evaluate_rules(db, project_id, {"p95_ms": 120.0}) == []
        opened = alerting.evaluate_rules(db, project_id, {"p95_ms": 950.0})
        assert len(opened) == 1
        assert opened[0].status == "firing" and opened[0].severity == "critical"
        assert "950ms" in opened[0].detail
        assert alerting.evaluate_rules(db, project_id, {"p95_ms": 990.0}) == []
    assert [item["event"] for item in published] == ["alert.triggered"]
    assert published[0]["data"]["id"] == str(opened[0].id)
    assert pushed == [opened[0].id]


def test_dispatcher_sends_rich_payload_and_prunes_dead_subscriptions(client, auth, owned, clean_subscriptions, monkeypatch):
    import pywebpush

    from app import push

    live, dead, muted = (f"{ENDPOINT}{name}-{uuid4().hex}" for name in ("live", "dead", "muted"))
    _subscribe(client, auth["headers"], live)
    _subscribe(client, auth["headers"], dead)
    _subscribe(client, auth["headers"], muted, ["info"])

    sent = []

    def fake_webpush(subscription_info, data, **kwargs):
        sent.append((subscription_info["endpoint"], json.loads(data), kwargs))
        if subscription_info["endpoint"] == dead:
            raise pywebpush.WebPushException("gone", response=SimpleNamespace(status_code=410))

    monkeypatch.setattr(pywebpush, "webpush", fake_webpush)
    with SessionLocal() as db:
        incident = AlertIncident(
            project_id=UUID(owned["project"]["id"]),
            rule_id=UUID(owned["rule_id"]),
            environment="prod",
            status="firing",
            severity="critical",
            title="Checkout p95",
            detail="p95 latency is 950ms (> 300ms)",
            started_at=db.execute(text("SELECT now()")).scalar(),
        )
        db.add(incident)
        db.commit()
        db.refresh(incident)
        push.notify_incident(db, incident, background=False)

    # The demo owner may also have real browser subscriptions; only look at this test's endpoints.
    sent = [item for item in sent if item[0].startswith(ENDPOINT)]
    assert {item[0] for item in sent} == {live, dead}
    payload = sent[0][1]
    assert payload["title"] == "Critical: Checkout p95"
    assert payload["image"] == "/push/critical.png"
    assert payload["requireInteraction"] is True
    assert payload["tag"] == f"incident-{incident.id}"
    assert [action["action"] for action in payload["actions"]] == ["view", "ack"]
    assert payload["data"]["url"].endswith(f"incident={incident.id}")
    assert payload["data"]["ack_token"]
    assert sent[0][2]["vapid_private_key"] == "test-private-key"
    with SessionLocal() as db:
        remaining = {row.endpoint for row in db.query(PushSubscription).filter(PushSubscription.endpoint.like(f"{ENDPOINT}%"))}
    assert dead not in remaining and live in remaining and muted in remaining


def test_dispatcher_is_a_no_op_without_vapid_keys(owned, monkeypatch):
    from app import push

    monkeypatch.setattr(settings, "vapid_private_key", "")
    with SessionLocal() as db:
        incident = db.query(AlertIncident).first()
        assert push.notify_incident(db, incident, background=False) == 0


def test_test_incident_and_ack_from_notification(client, auth, owned, monkeypatch):
    from app import alerting
    from app.security import issue_push_ack_token

    monkeypatch.setattr(alerting, "notify_incident", lambda db, incident: 0)
    project_id = owned["project"]["id"]
    fired = client.post(f"/projects/{project_id}/alert-rules/{owned['rule_id']}/test", headers=auth["headers"])
    assert fired.status_code == 201, fired.text
    incident = fired.json()
    assert incident["status"] == "firing"
    assert incident["detail"].startswith("Test incident.")

    with SessionLocal() as db:
        owner_id = db.get(Project, UUID(project_id)).owner_id
    assert client.post("/push/ack", json={"token": "not-a-token"}).status_code == 401
    assert client.post("/push/ack", json={"token": issue_push_ack_token(uuid4(), UUID(incident["id"]))}).status_code == 404
    # An access token must not work as an acknowledge token.
    assert client.post("/push/ack", json={"token": auth["token"]}).status_code == 401

    token = issue_push_ack_token(owner_id, UUID(incident["id"]))
    acked = client.post("/push/ack", json={"token": token})
    assert acked.status_code == 200, acked.text
    assert acked.json()["status"] == "acknowledged"
    assert acked.json()["ack_note"] == "Acknowledged from a push notification"
    assert client.post("/push/ack", json={"token": token}).status_code == 200


def test_test_endpoint_is_owner_only(client, owned):
    email, member = _member(client)
    try:
        response = client.post(
            f"/projects/{owned['project']['id']}/alert-rules/{owned['rule_id']}/test", headers=member
        )
        assert response.status_code == 404
    finally:
        _delete_user(email)


def test_rule_metric_names_cover_dialog_labels_and_snapshot_fields():
    from app.alerting import metric_field

    assert metric_field("p95 latency") == metric_field("p95_ms")
    assert metric_field("Error rate") == metric_field("error_pct")
    assert metric_field("CPU")[0] == "cpu_pct"
    assert metric_field("throughput")[0] == "rps"
    assert metric_field("apdex") is None
