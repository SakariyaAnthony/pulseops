from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import settings
from app.db import engine

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz():
    db_ok = False
    redis_ok = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    try:
        import redis

        redis_ok = bool(redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.4).ping())
    except Exception:
        redis_ok = False
    body = {"status": "ok" if db_ok else "degraded", "db": db_ok, "redis": redis_ok}
    return JSONResponse(status_code=200 if db_ok else 503, content=body)
