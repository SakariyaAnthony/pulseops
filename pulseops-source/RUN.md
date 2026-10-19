# Run PulseOps locally

Start the databases, then the API, then the dashboard. Use two terminals after Docker is up.

You need Docker, Python 3.11+, and Node.js 20+.

## 1. Databases

From the `infra` folder:

```bash
docker compose up -d timescaledb redis
```

- TimescaleDB: `127.0.0.1:54329` (user `pulseops`, password `pulseops`, database `pulseops`)
- Redis: `127.0.0.1:63799`

Wait until both containers are healthy (`docker compose ps`).

## 2. API

From `apps/api`:

```bash
python3 -m venv .venv
```

macOS and Linux:

```bash
. .venv/bin/activate
```

Windows:

```bash
.venv\Scripts\activate
```

Then:

```bash
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
python -m app
```

The API listens on http://127.0.0.1:47322. Check http://127.0.0.1:47322/healthz (`db` and `redis` should both be true). API docs are at http://127.0.0.1:47322/docs.

`apps/api/.env.example` already matches these local ports. Copy it to `.env` only if you change the database or Redis address.

## 3. Dashboard

In a second terminal, from `apps/web`:

```bash
npm install
npm run dev
```

The dashboard listens on http://127.0.0.1:47321 and calls `http://127.0.0.1:47322` (`VITE_API_URL`).

## 4. Sign in

Open http://127.0.0.1:47321

- Email: `demo@pulseops.dev`
- Password: `pulseops-demo`
- Project: `shop-api`
- Environment: `prod`

The overview should show the seeded shop traffic (about 95 ms average, not the offline mock of 182 ms). The sidebar says **Live API** when the health check succeeds.

Ingest key for the demo project: `po_live_shop_api_demo_key`.

## Stop

Stop the dashboard and the API with Ctrl+C in each terminal. Then:

```bash
cd infra
docker compose stop timescaledb redis
```
