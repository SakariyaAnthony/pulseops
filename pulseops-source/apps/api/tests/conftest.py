import os
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def client():
    os.chdir(ROOT)
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    from app.seed import seed

    seed()
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session")
def auth(client):
    response = client.post(
        "/auth/login",
        json={"email": "demo@pulseops.dev", "password": "pulseops-demo"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    return {
        "token": body["access_token"],
        "refresh": body["refresh_token"],
        "headers": {"Authorization": f"Bearer {body['access_token']}"},
        "body": body,
    }


@pytest.fixture(scope="session")
def project_id(client, auth):
    response = client.get("/projects", headers=auth["headers"])
    assert response.status_code == 200, response.text
    match = next(item for item in response.json()["projects"] if item["slug"] == "shop-api")
    return match["id"]
