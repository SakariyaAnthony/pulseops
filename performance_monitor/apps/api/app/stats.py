"""Window parsing and histogram stats. No database imports."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.constants import BUCKET_EDGES

RANGES: dict[str, timedelta] = {
    "15m": timedelta(minutes=15),
    "1h": timedelta(hours=1),
    "6h": timedelta(hours=6),
    "24h": timedelta(hours=24),
    "7d": timedelta(days=7),
}
DEFAULT_RESOLUTION = {
    "15m": "1m",
    "1h": "1m",
    "6h": "5m",
    "24h": "15m",
    "7d": "1h",
}
INTERVALS = {
    "1m": "1 minute",
    "5m": "5 minutes",
    "15m": "15 minutes",
    "1h": "1 hour",
}
WIDTH_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "1h": 60}


class WindowError(ValueError):
    pass


@dataclass(frozen=True)
class Window:
    label: str
    start: datetime
    end: datetime
    env: str | None
    resolution: str

    @property
    def minutes(self) -> float:
        return max((self.end - self.start).total_seconds() / 60.0, 1e-9)

    def previous(self) -> "Window":
        delta = self.end - self.start
        return Window(self.label, self.start - delta, self.start, self.env, self.resolution)


def make_window(
    range_key: str = "1h",
    env: str | None = None,
    resolution: str | None = None,
    start_ms: int | None = None,
    end_ms: int | None = None,
) -> Window:
    if env == "":
        env = None
    if (start_ms is None) ^ (end_ms is None):
        raise WindowError("from and to must be provided together")
    if start_ms is not None and end_ms is not None:
        if end_ms <= start_ms:
            raise WindowError("to must be after from")
        start = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc)
        end = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc)
        if end - start > timedelta(days=14):
            raise WindowError("range cannot exceed 14 days")
        label = range_key if range_key in RANGES else "custom"
    else:
        if range_key not in RANGES:
            raise WindowError("range must be one of 15m, 1h, 6h, 24h, 7d")
        end = datetime.now(timezone.utc)
        start = end - RANGES[range_key]
        label = range_key
    if resolution is None:
        resolution = DEFAULT_RESOLUTION.get(label, "1m")
    if resolution not in INTERVALS:
        raise WindowError("resolution must be one of 1m, 5m, 15m, 1h")
    return Window(label, start, end, env, resolution)


def to_ms(value: datetime) -> int:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return int(value.timestamp() * 1000)


def estimate_percentile(total: float, cumulative: list[float], p: float) -> float | None:
    if total <= 0:
        return None
    target = total * p
    prev_edge = 0.0
    prev_count = 0.0
    for edge, count in zip(BUCKET_EDGES, cumulative):
        if count >= target:
            span = count - prev_count
            if span <= 0:
                return float(edge)
            frac = (target - prev_count) / span
            return prev_edge + frac * (edge - prev_edge)
        prev_edge = float(edge)
        prev_count = count
    if total > prev_count:
        frac = (target - prev_count) / (total - prev_count)
        return prev_edge + frac * prev_edge * 0.25
    return float(BUCKET_EDGES[-1])


def delta_pct(current: float, previous: float) -> float | None:
    if previous == 0:
        return None
    return round((current - previous) / abs(previous) * 100, 2)


def health_of(p95: float, error_pct: float) -> str:
    if error_pct >= 5 or p95 >= 1500:
        return "critical"
    if error_pct >= 1 or p95 >= 800:
        return "degraded"
    return "healthy"
