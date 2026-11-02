import asyncio
import json
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.config import settings
from app.db import SessionLocal
from app.deps import fetch_project
from app.models import User
from app.queries import build_snapshot, firing_incidents
from app.redis_bus import channel_for
from app.security import decode_token
from app.serialize import incident_out
from app.stats import to_ms

router = APIRouter(tags=["realtime"])


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    project_id: str = Query(...),
    token: str = Query(...),
):
    await websocket.accept()
    try:
        payload = decode_token(token, "access")
        user_id = UUID(payload["sub"])
    except (ValueError, KeyError):
        await websocket.close(code=4401)
        return

    with SessionLocal() as db:
        user = db.get(User, user_id)
        if user is None:
            await websocket.close(code=4401)
            return
        try:
            project = fetch_project(db, user, project_id)
        except Exception:
            await websocket.close(code=4404)
            return
        snapshot = build_snapshot(db, project.id)
        incidents = [incident_out(item, replay=True) for item in firing_incidents(db, project.id)]
        pid = project.id

    await websocket.send_json({"event": "metrics.snapshot", "data": snapshot})
    for incident in incidents:
        await websocket.send_json({"event": "alert.triggered", "data": incident})

    redis = None
    pubsub = None
    try:
        import redis.asyncio as aioredis

        redis = aioredis.from_url(settings.redis_url, socket_connect_timeout=1, socket_timeout=1)
        pubsub = redis.pubsub()
        await pubsub.subscribe(channel_for(pid))
    except Exception:
        pubsub = None

    async def pump_redis() -> None:
        if pubsub is None:
            return
        while True:
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                data = message["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                await websocket.send_text(data)
            else:
                await asyncio.sleep(0.2)

    async def pump_client() -> None:
        while True:
            incoming = await websocket.receive_text()
            try:
                body = json.loads(incoming)
            except json.JSONDecodeError:
                continue
            action = body.get("action")
            if action in {"subscribe", "unsubscribe"}:
                event = "subscribed" if action == "subscribe" else "unsubscribed"
                await websocket.send_json({"event": event, "data": {"channel": body.get("channel")}})

    async def heartbeat() -> None:
        while True:
            await asyncio.sleep(25)
            await websocket.send_json(
                {"event": "ping", "data": {"time": to_ms(datetime.now(timezone.utc))}}
            )

    tasks = [asyncio.create_task(pump_client()), asyncio.create_task(heartbeat())]
    if pubsub is not None:
        tasks.append(asyncio.create_task(pump_redis()))
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in pending:
            task.cancel()
        for task in done:
            error = task.exception()
            if error and not isinstance(error, WebSocketDisconnect):
                raise error
    finally:
        for task in tasks:
            task.cancel()
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(channel_for(pid))
                await pubsub.aclose()
            except Exception:
                pass
        if redis is not None:
            try:
                await redis.aclose()
            except Exception:
                pass
