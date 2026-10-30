from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.deps import get_current_user
from app.models import AlertIncident, Project, PushSubscription, User
from app.schemas import PushAckIn, PushSubscriptionIn, PushSubscriptionPatch, PushUnsubscribeIn
from app.security import decode_token
from app.serialize import incident_out, push_subscription_out

router = APIRouter(prefix="/push", tags=["push"])


def _unique(severities: list[str]) -> list[str]:
    return list(dict.fromkeys(severities))


@router.get("/vapid-key")
def vapid_key():
    return {"enabled": settings.push_enabled, "public_key": settings.vapid_public_key or None}


@router.get("/subscriptions")
def list_subscriptions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = (
        db.query(PushSubscription)
        .filter(PushSubscription.user_id == user.id)
        .order_by(PushSubscription.created_at)
        .all()
    )
    return {"subscriptions": [push_subscription_out(row) for row in rows]}


@router.post("/subscriptions", status_code=201)
def upsert_subscription(
    body: PushSubscriptionIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not settings.push_enabled:
        raise HTTPException(status_code=503, detail="Push notifications are not configured on this server")
    now = datetime.now(timezone.utc)
    row = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).one_or_none()
    if row is None:
        row = PushSubscription(endpoint=body.endpoint, created_at=now)
        db.add(row)
    # A browser endpoint belongs to whoever signed in on it most recently.
    row.user_id = user.id
    row.p256dh = body.keys.p256dh
    row.auth = body.keys.auth
    row.user_agent = body.user_agent
    row.severities = _unique(body.severities)
    row.last_seen_at = now
    db.commit()
    db.refresh(row)
    return push_subscription_out(row)


@router.patch("/subscriptions/{subscription_id}")
def patch_subscription(
    subscription_id: UUID,
    body: PushSubscriptionPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.get(PushSubscription, subscription_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Subscription not found")
    row.severities = _unique(body.severities)
    db.commit()
    db.refresh(row)
    return push_subscription_out(row)


@router.delete("/subscriptions", status_code=204)
def delete_subscription(
    body: PushUnsubscribeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == user.id
    ).delete(synchronize_session=False)
    db.commit()
    return None


@router.post("/ack")
def ack_from_notification(body: PushAckIn, db: Session = Depends(get_db)):
    try:
        payload = decode_token(body.token, "push_ack")
        user_id = UUID(payload["sub"])
        incident_id = UUID(payload["inc"])
    except (ValueError, KeyError):
        raise HTTPException(status_code=401, detail="Invalid or expired acknowledge link")
    user = db.get(User, user_id)
    incident = db.get(AlertIncident, incident_id)
    if user is None or not user.is_active or incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    project = db.get(Project, incident.project_id)
    if project is None or project.owner_id != user.id:
        raise HTTPException(status_code=404, detail="Incident not found")
    if incident.status == "resolved":
        raise HTTPException(status_code=409, detail="Incident is resolved")
    if incident.status != "acknowledged":
        incident.status = "acknowledged"
        incident.acked_at = datetime.now(timezone.utc)
        incident.ack_note = incident.ack_note or "Acknowledged from a push notification"
        db.commit()
        db.refresh(incident)
    return incident_out(incident)
