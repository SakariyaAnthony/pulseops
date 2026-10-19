from __future__ import annotations

import json
import logging
import time

from fastapi import HTTPException

from app.config import settings

logger = logging.getLogger("pulseops.redis")


def _client():
    import redis

    return redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.4, socket_timeout=0.4)


def channel_for(project_id) -> str:
    return f"pulseops:{project_id}"


def publish(project_id, payload: dict) -> None:
    try:
        client = _client()
        client.publish(channel_for(project_id), json.dumps(payload))
    except Exception:
        logger.warning("redis publish failed", exc_info=True)


def enforce_rate_limit(key_id) -> None:
    try:
        client = _client()
        bucket = f"pulseops:rl:{key_id}:{int(time.time()) // 60}"
        count = int(client.incr(bucket))
        if count == 1:
            client.expire(bucket, 120)
        if count > settings.rate_limit_per_minute:
            raise HTTPException(status_code=429, detail="Rate limit exceeded")
    except HTTPException:
        raise
    except Exception:
        logger.warning("rate limit skipped", exc_info=True)


def remember_refresh(jti: str, ttl_seconds: int) -> bool:
    """Return False when this refresh jti was already used. Fail open if Redis is down."""
    try:
        client = _client()
        stored = client.set(f"pulseops:refresh:{jti}", "1", nx=True, ex=max(ttl_seconds, 1))
        return bool(stored)
    except Exception:
        logger.warning("refresh denylist skipped", exc_info=True)
        return True
