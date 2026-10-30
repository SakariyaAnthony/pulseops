"""Minimal alert rule evaluation against the live one-minute snapshot."""

from __future__ import annotations

import logging
import operator
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AlertIncident, AlertRule
from app.push import notify_incident
from app.redis_bus import publish
from app.serialize import incident_out

logger = logging.getLogger("pulseops.alerting")

# Rule metrics come from two sources: the dashboard dialog labels and the snapshot field names.
METRIC_FIELDS = {
    "p95 latency": ("p95_ms", "ms", "p95 latency"),
    "p95_ms": ("p95_ms", "ms", "p95 latency"),
    "error rate": ("error_pct", "%", "Error rate"),
    "error_pct": ("error_pct", "%", "Error rate"),
    "cpu": ("cpu_pct", "%", "CPU"),
    "cpu_pct": ("cpu_pct", "%", "CPU"),
    "throughput": ("rps", " rps", "Throughput"),
    "rps": ("rps", " rps", "Throughput"),
}

OPERATORS = {
    "gt": (operator.gt, ">"),
    "gte": (operator.ge, ">="),
    "lt": (operator.lt, "<"),
    "lte": (operator.le, "<="),
    "eq": (operator.eq, "="),
}

OPEN_STATUSES = ("firing", "acknowledged")


def metric_field(metric: str) -> tuple[str, str, str] | None:
    return METRIC_FIELDS.get(metric.strip().lower())


def _format(value: float, unit: str) -> str:
    return f"{value:g}{unit}"


def open_incident(db: Session, rule: AlertRule, value: float | None, *, test: bool = False) -> AlertIncident:
    """Create a firing incident for a rule, then announce it over the WebSocket and Web Push."""
    field = metric_field(rule.metric)
    unit = field[1] if field else ""
    label = field[2] if field else rule.metric
    symbol = OPERATORS.get(rule.operator, (None, rule.operator))[1]
    if value is None:
        detail = f"{label} {symbol} {_format(rule.threshold, unit)}"
    else:
        detail = f"{label} is {_format(value, unit)} ({symbol} {_format(rule.threshold, unit)})"
    if test:
        detail = f"Test incident. {detail}"
    incident = AlertIncident(
        project_id=rule.project_id,
        rule_id=rule.id,
        environment=rule.environment,
        status="firing",
        severity=rule.severity,
        title=rule.name,
        detail=detail,
        started_at=datetime.now(timezone.utc),
    )
    db.add(incident)
    db.commit()
    db.refresh(incident)
    publish(rule.project_id, {"event": "alert.triggered", "data": incident_out(incident)})
    notify_incident(db, incident)
    return incident


def evaluate_rules(db: Session, project_id: UUID, snapshot: dict) -> list[AlertIncident]:
    """Open an incident for each enabled rule that breaches and has no open incident yet."""
    rules = (
        db.query(AlertRule)
        .filter(AlertRule.project_id == project_id, AlertRule.enabled.is_(True))
        .all()
    )
    opened: list[AlertIncident] = []
    for rule in rules:
        field = metric_field(rule.metric)
        compare = OPERATORS.get(rule.operator)
        if field is None or compare is None:
            continue
        value = snapshot.get(field[0])
        if value is None or not compare[0](float(value), rule.threshold):
            continue
        already_open = (
            db.query(AlertIncident.id)
            .filter(AlertIncident.rule_id == rule.id, AlertIncident.status.in_(OPEN_STATUSES))
            .first()
        )
        if already_open is not None:
            continue
        try:
            opened.append(open_incident(db, rule, float(value)))
        except Exception:
            db.rollback()
            logger.warning("opening incident failed for rule %s", rule.id, exc_info=True)
    return opened
