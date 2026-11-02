# PulseOps API

FastAPI query and ingest service for PulseOps. It stores request, resource, and error series in TimescaleDB and fans live snapshots out through Redis.

The HTTP API listens on port **47322**.

## Run locally

From `infra`, start the databases:

```bash
docker compose up -d timescaledb redis
```

TimescaleDB is published on `127.0.0.1:54329` and Redis on `127.0.0.1:63799`. The local password is `pulseops` / `pulseops`.

Then, from `apps/api`:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
python -m app
```

`python -m app` serves `http://127.0.0.1:47322`. Interactive docs are at `/docs`.

To run the API inside Compose as well (do not also bind port 47322 on the host):

```bash
docker compose up --build
```

## Demo login

| | |
|---|---|
| Email | `demo@pulseops.dev` |
| Password | `pulseops-demo` |
| Project | `shop-api` (prod and staging) |
| Ingest key | `po_live_shop_api_demo_key` |

The seed loads about 24 hours of shop traffic, error groups, deploy markers, and two firing incidents. `python -m app.seed --force` rebuilds that window.

Request rows carry a `weight` so the seed can represent real request volume without storing tens of millions of raw samples. Ingested SDK rows use weight `1`.

## Auth

Query routes expect `Authorization: Bearer <jwt>`. Ingest routes expect `X-API-Key`. Every project query is scoped to the signed-in owner. `project_id` in the path may be the UUID or the slug.

`POST /auth/login` and `POST /auth/refresh` return `access_token`, `refresh_token`, `expires_in`, and `user`. Refresh tokens rotate once.

## Tests

With Timescale and Redis up:

```bash
pytest
```

## Routes

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | `db` and `redis` flags |
| POST | `/auth/login`, `/auth/refresh` | |
| GET, POST | `/projects` | POST also returns a one-time `api_key.token` |
| GET | `/projects/{id}` | |
| GET | `/projects/{id}/overview?range=15m\|1h\|6h\|24h\|7d` | KPIs, charts, services, incidents |
| GET | `/projects/{id}/metrics/timeseries` | `metric`, `resolution`, optional `from` / `to` |
| GET | `/projects/{id}/services`, `/services/{svc}` | |
| GET | `/projects/{id}/endpoints`, `/endpoints/{key}` | key is `METHOD /route` |
| GET | `/projects/{id}/resources` | optional `host` |
| GET | `/projects/{id}/errors`, `/errors/{fingerprint}` | |
| GET, POST | `/projects/{id}/alert-rules` | |
| GET, PATCH, DELETE | `/projects/{id}/alert-rules/{rule_id}` | |
| GET | `/incidents?project_id=` | optional `status` |
| POST | `/incidents/{id}/ack` | `{ "note": "..." }` |
| POST | `/ingest/v1/metrics`, `/errors`, `/events` | `202 {"accepted": n}` |
| GET | `/ws?project_id=&token=` | websocket |

Optional query params on the read routes: `env` (or `environment`), `resolution` (`1m`, `5m`, `15m`, `1h`).

Timeseries points are `[epoch_ms, value]`. Deploy markers on those payloads are `{ "time": epoch_ms, "version": "..." }`.

```json
{
  "metric": "response_time",
  "resolution": "1m",
  "series": [{ "name": "p95", "points": [[1739800000000, 642.1]] }],
  "deploys": [{ "time": 1739800900000, "version": "v2.14.1" }]
}
```

`metric` is one of `response_time`, `throughput`, `error_rate`, `cpu`, `memory`, `disk_read`, `disk_write`, `net_in`, `net_out`. `response_time` returns `p50`, `p95`, and `p99`.

Overview KPIs are `avg_ms`, `p95_ms`, `rpm`, `error_pct`, and `apdex` (T = 500 ms). Each has `value`, `delta_pct` versus the previous window, and `sparkline`.

The websocket sends `metrics.snapshot` on connect, then one `alert.triggered` per firing incident (`data.replay` is true for those). Later snapshots published by ingest are forwarded from Redis. Clients may send `{"action":"subscribe","channel":"overview"}`. A `ping` is sent every 25 seconds.

`POST /ingest/v1/events` stores `type: "deploy"` (requires `version`) and accepts other event types with `202` without persisting them.
