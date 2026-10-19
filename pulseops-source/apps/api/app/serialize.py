from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models import AlertIncident, AlertRule, ApiKey, Environment, Project, User
from app.stats import to_ms


def iso(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def user_out(user: User) -> dict:
    return {"id": str(user.id), "email": user.email, "name": user.name}


def project_out(db: Session, project: Project, *, include_demo_token: bool = True) -> dict:
    envs = (
        db.query(Environment)
        .filter(Environment.project_id == project.id)
        .order_by(Environment.name)
        .all()
    )
    keys = (
        db.query(ApiKey)
        .filter(ApiKey.project_id == project.id, ApiKey.revoked_at.is_(None))
        .order_by(ApiKey.created_at)
        .all()
    )
    return {
        "id": str(project.id),
        "slug": project.slug,
        "name": project.name,
        "created_at": iso(project.created_at),
        "environments": [{"id": str(env.id), "name": env.name} for env in envs],
        "api_keys": [
            {
                "id": str(key.id),
                "name": key.name,
                "prefix": key.key_prefix,
                "created_at": iso(key.created_at),
                "demo_token": key.demo_token if include_demo_token else None,
            }
            for key in keys
        ],
    }


def rule_out(rule: AlertRule) -> dict:
    return {
        "id": str(rule.id),
        "project_id": str(rule.project_id),
        "name": rule.name,
        "metric": rule.metric,
        "operator": rule.operator,
        "threshold": rule.threshold,
        "window": rule.window,
        "severity": rule.severity,
        "channels": list(rule.channels or []),
        "environment": rule.environment,
        "enabled": rule.enabled,
        "created_at": iso(rule.created_at),
    }


def incident_out(incident: AlertIncident, *, replay: bool = False) -> dict:
    payload = {
        "id": str(incident.id),
        "project_id": str(incident.project_id),
        "rule_id": str(incident.rule_id) if incident.rule_id else None,
        "rule_name": incident.rule.name if incident.rule is not None else None,
        "environment": incident.environment,
        "status": incident.status,
        "severity": incident.severity,
        "title": incident.title,
        "detail": incident.detail,
        "ack_note": incident.ack_note,
        "started_at": iso(incident.started_at),
        "acked_at": iso(incident.acked_at),
        "resolved_at": iso(incident.resolved_at),
    }
    if replay:
        payload["replay"] = True
    return payload


def deploy_marker(time: datetime, version: str) -> dict:
    return {"time": to_ms(time), "version": version}
