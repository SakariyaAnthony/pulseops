"""Browser Web Push delivery for alert incidents."""

from __future__ import annotations

import json
import logging
import sys
import threading
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import AlertIncident, Project, PushSubscription
from app.security import issue_push_ack_token
from app.serialize import incident_out, iso

logger = logging.getLogger("pulseops.push")

SEVERITY_LABEL = {"critical": "Critical", "warning": "Warning", "info": "Info"}

# Same fallback as app.scan: a root-owned venv can keep extra packages in apps/api/.vendor.
_vendor = Path(__file__).resolve().parents[1] / ".vendor"
if _vendor.is_dir() and str(_vendor) not in sys.path:
    sys.path.append(str(_vendor))


@dataclass(frozen=True)
class Delivery:
    subscription_id: UUID
    endpoint: str
    p256dh: str
    auth: str
    payload: str


def build_payload(incident: AlertIncident, project: Project, user_id: UUID) -> dict:
    severity = incident.severity if incident.severity in SEVERITY_LABEL else "info"
    rule_name = incident.rule.name if incident.rule is not None else None
    context = " · ".join(part for part in (project.name, incident.environment, rule_name) if part)
    body = incident.detail or "An alert rule crossed its threshold."
    return {
        "title": f"{SEVERITY_LABEL[severity]}: {incident.title}",
        "body": f"{body}\n{context}" if context else body,
        "icon": "/push/icon-192.png",
        "badge": "/push/badge-72.png",
        "image": f"/push/{severity}.png",
        "tag": f"incident-{incident.id}",
        "renotify": True,
        "requireInteraction": severity == "critical",
        "timestamp": int(incident.started_at.timestamp() * 1000),
        "actions": [
            {"action": "view", "title": "View incident"},
            {"action": "ack", "title": "Acknowledge"},
        ],
        "data": {
            "url": f"/alerts?project={project.slug}&incident={incident.id}",
            "incident_id": str(incident.id),
            "project_id": str(project.id),
            "severity": severity,
            "started_at": iso(incident.started_at),
            "ack_token": issue_push_ack_token(user_id, incident.id),
            "incident": incident_out(incident),
        },
    }


def collect_deliveries(db: Session, incident: AlertIncident) -> list[Delivery]:
    project = db.get(Project, incident.project_id)
    if project is None:
        return []
    payload = json.dumps(build_payload(incident, project, project.owner_id))
    rows = db.query(PushSubscription).filter(PushSubscription.user_id == project.owner_id).all()
    return [
        Delivery(row.id, row.endpoint, row.p256dh, row.auth, payload)
        for row in rows
        if incident.severity in (row.severities or [])
    ]


def send_deliveries(deliveries: list[Delivery]) -> list[UUID]:
    """Send each payload. Return the subscriptions the push service says are gone."""
    from pywebpush import WebPushException, webpush

    gone: list[UUID] = []
    for item in deliveries:
        try:
            webpush(
                subscription_info={"endpoint": item.endpoint, "keys": {"p256dh": item.p256dh, "auth": item.auth}},
                data=item.payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims={"sub": settings.vapid_subject},
                ttl=60 * 60,
                headers={"Urgency": "high"},
            )
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                gone.append(item.subscription_id)
            else:
                logger.warning("push delivery failed (%s)", status, exc_info=True)
        except Exception:
            logger.warning("push delivery failed", exc_info=True)
    return gone


def prune(subscription_ids: list[UUID]) -> None:
    if not subscription_ids:
        return
    with SessionLocal() as db:
        db.query(PushSubscription).filter(PushSubscription.id.in_(subscription_ids)).delete(
            synchronize_session=False
        )
        db.commit()


def _deliver(deliveries: list[Delivery]) -> None:
    prune(send_deliveries(deliveries))


def notify_incident(db: Session, incident: AlertIncident, *, background: bool = True) -> int:
    """Queue a push for every subscribed browser of the project owner. Returns how many were queued."""
    if not settings.push_enabled:
        return 0
    try:
        deliveries = collect_deliveries(db, incident)
    except Exception:
        logger.warning("push collect failed", exc_info=True)
        return 0
    if not deliveries:
        return 0
    if background:
        threading.Thread(target=_deliver, args=(deliveries,), daemon=True).start()
    else:
        _deliver(deliveries)
    return len(deliveries)
