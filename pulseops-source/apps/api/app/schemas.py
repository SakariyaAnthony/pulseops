from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, Field


def coerce_time(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 10_000_000_000 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc)
    if isinstance(value, str):
        if value.isdigit():
            return coerce_time(int(value))
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    raise ValueError("invalid time")


FlexibleTime = Annotated[datetime | None, BeforeValidator(coerce_time)]


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=256)


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=10)


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    slug: str | None = Field(default=None, max_length=80)


class AlertRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    metric: str = Field(min_length=1, max_length=64)
    operator: Literal["gt", "gte", "lt", "lte", "eq"]
    threshold: float
    window: str = Field(pattern=r"^[1-9][0-9]{0,3}(s|m|h|d)$")
    severity: Literal["info", "warning", "critical"]
    channels: list[str] = Field(default_factory=list, max_length=20)
    environment: str | None = Field(default=None, max_length=64)
    enabled: bool = True


class AlertRulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    metric: str | None = Field(default=None, min_length=1, max_length=64)
    operator: Literal["gt", "gte", "lt", "lte", "eq"] | None = None
    threshold: float | None = None
    window: str | None = Field(default=None, pattern=r"^[1-9][0-9]{0,3}(s|m|h|d)$")
    severity: Literal["info", "warning", "critical"] | None = None
    channels: list[str] | None = Field(default=None, max_length=20)
    environment: str | None = Field(default=None, max_length=64)
    enabled: bool | None = None


class AckIn(BaseModel):
    note: str | None = Field(default=None, max_length=2000)


class RequestPoint(BaseModel):
    time: FlexibleTime = None
    env: str = Field(default="prod", max_length=64)
    service: str = Field(min_length=1, max_length=120)
    host: str | None = Field(default=None, max_length=120)
    method: str = Field(min_length=1, max_length=16)
    route: str = Field(min_length=1, max_length=300)
    status_code: int = Field(ge=100, le=599)
    duration_ms: float = Field(ge=0, le=3_600_000)
    trace_id: str | None = Field(default=None, max_length=128)
    version: str | None = Field(default=None, max_length=64)


class ResourcePoint(BaseModel):
    time: FlexibleTime = None
    env: str = Field(default="prod", max_length=64)
    service: str | None = Field(default=None, max_length=120)
    host: str | None = Field(default=None, max_length=120)
    cpu_pct: float | None = Field(default=None, ge=0, le=100)
    mem_rss_mb: float | None = Field(default=None, ge=0)
    heap_used_mb: float | None = Field(default=None, ge=0)
    disk_read_bps: int | None = Field(default=None, ge=0)
    disk_write_bps: int | None = Field(default=None, ge=0)
    net_in_bps: int | None = Field(default=None, ge=0)
    net_out_bps: int | None = Field(default=None, ge=0)
    event_loop_lag_ms: float | None = Field(default=None, ge=0)
    gc_pause_ms: float | None = Field(default=None, ge=0)


class MetricsIn(BaseModel):
    requests: list[RequestPoint] = Field(default_factory=list, max_length=5000)
    resources: list[ResourcePoint] = Field(default_factory=list, max_length=5000)


class ErrorPoint(BaseModel):
    time: FlexibleTime = None
    env: str = Field(default="prod", max_length=64)
    service: str | None = Field(default=None, max_length=120)
    fingerprint: str = Field(min_length=1, max_length=200)
    type: str | None = Field(default=None, max_length=120)
    message: str | None = Field(default=None, max_length=2000)
    stack: str | None = Field(default=None, max_length=20000)
    route: str | None = Field(default=None, max_length=300)
    trace_id: str | None = Field(default=None, max_length=128)
    context: dict[str, Any] = Field(default_factory=dict)


class ErrorsIn(BaseModel):
    errors: list[ErrorPoint] = Field(default_factory=list, max_length=5000)


class EventPoint(BaseModel):
    type: str = Field(min_length=1, max_length=64)
    time: FlexibleTime = None
    env: str = Field(default="prod", max_length=64)
    service: str | None = Field(default=None, max_length=120)
    version: str | None = Field(default=None, max_length=64)
    commit_sha: str | None = Field(default=None, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


class EventsIn(BaseModel):
    events: list[EventPoint] = Field(default_factory=list, max_length=1000)
