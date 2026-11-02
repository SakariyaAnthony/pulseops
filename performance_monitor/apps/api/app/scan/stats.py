from __future__ import annotations

import math
import re

UUID_SEGMENT = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
NUMBER_SEGMENT = re.compile(r"^\d+$")


def normalize_endpoint(path: str) -> str:
    pieces = []
    for piece in path.split("/"):
        if piece and (NUMBER_SEGMENT.match(piece) or UUID_SEGMENT.match(piece)):
            pieces.append("{id}")
        else:
            pieces.append(piece)
    normalized = "/".join(pieces)
    return normalized or "/"


def percentile(samples: list[float], pct: float) -> float | None:
    if not samples:
        return None
    if pct >= 99 and len(samples) < 20:
        return None
    if pct >= 95 and len(samples) < 5:
        return None
    ordered = sorted(samples)
    rank = max(0, math.ceil(pct / 100 * len(ordered)) - 1)
    return ordered[min(rank, len(ordered) - 1)]


def median(samples: list[float]) -> float | None:
    return percentile(samples, 50) if samples else None


def observation_record(
    *,
    route: str,
    method: str,
    url_path: str,
    status_code: int | None,
    duration_ms: float | None,
    transfer_bytes: int | None,
    failure_type: str | None,
    resource_type: str | None,
) -> dict:
    """Keep request metadata only. Headers, cookies, and bodies are not accepted."""
    return {
        "route": route,
        "endpoint_template": normalize_endpoint(url_path.split("?", 1)[0].split("#", 1)[0] or "/"),
        "method": method.upper()[:16] or "GET",
        "status_code": status_code,
        "duration_ms": duration_ms,
        "transfer_bytes": transfer_bytes,
        "failure_type": failure_type,
        "resource_type": resource_type,
    }
