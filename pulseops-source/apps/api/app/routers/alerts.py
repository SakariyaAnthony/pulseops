from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import fetch_project, get_current_user, get_owned_project
from app.models import AlertIncident, AlertRule, Project, User
from app.schemas import AckIn, AlertRuleIn, AlertRulePatch
from app.serialize import incident_out, rule_out

router = APIRouter(tags=["alerts"])


def _rule_or_404(db: Session, project: Project, rule_id: UUID) -> AlertRule:
    rule = db.get(AlertRule, rule_id)
    if rule is None or rule.project_id != project.id:
        raise HTTPException(status_code=404, detail="Alert rule not found")
    return rule


@router.get("/projects/{project_id}/alert-rules")
def list_rules(project: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    rules = (
        db.query(AlertRule)
        .filter(AlertRule.project_id == project.id)
        .order_by(AlertRule.created_at)
        .all()
    )
    return {"rules": [rule_out(rule) for rule in rules]}


@router.post("/projects/{project_id}/alert-rules", status_code=201)
def create_rule(
    body: AlertRuleIn,
    project: Project = Depends(get_owned_project),
    db: Session = Depends(get_db),
):
    rule = AlertRule(project_id=project.id, **body.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule_out(rule)


@router.get("/projects/{project_id}/alert-rules/{rule_id}")
def get_rule(rule_id: UUID, project: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    return rule_out(_rule_or_404(db, project, rule_id))


@router.patch("/projects/{project_id}/alert-rules/{rule_id}")
def patch_rule(
    rule_id: UUID,
    body: AlertRulePatch,
    project: Project = Depends(get_owned_project),
    db: Session = Depends(get_db),
):
    rule = _rule_or_404(db, project, rule_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rule, field, value)
    db.commit()
    db.refresh(rule)
    return rule_out(rule)


@router.delete("/projects/{project_id}/alert-rules/{rule_id}", status_code=204)
def delete_rule(rule_id: UUID, project: Project = Depends(get_owned_project), db: Session = Depends(get_db)):
    rule = _rule_or_404(db, project, rule_id)
    db.delete(rule)
    db.commit()
    return None


@router.get("/incidents")
def list_incidents(
    project_id: str = Query(...),
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    project = fetch_project(db, user, project_id)
    query = db.query(AlertIncident).filter(AlertIncident.project_id == project.id)
    if status:
        query = query.filter(AlertIncident.status == status)
    incidents = query.order_by(AlertIncident.started_at.desc()).all()
    return {"incidents": [incident_out(item) for item in incidents]}


@router.post("/incidents/{incident_id}/ack")
def ack_incident(
    incident_id: UUID,
    body: AckIn | None = Body(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    incident = db.get(AlertIncident, incident_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    fetch_project(db, user, str(incident.project_id))
    if incident.status == "resolved":
        raise HTTPException(status_code=409, detail="Incident is resolved")
    incident.status = "acknowledged"
    incident.acked_at = datetime.now(timezone.utc)
    if body and body.note:
        incident.ack_note = body.note
    db.commit()
    db.refresh(incident)
    return incident_out(incident)
