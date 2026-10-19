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

## 5. Scan a React app

Create a project so its traffic stays separate from the seeded shop. From any directory, with the API running:

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:47322/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"demo@pulseops.dev","password":"pulseops-demo"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')

curl -s -X POST http://127.0.0.1:47322/projects \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"My React app"}'
```

Copy `api_key.token` from that response. It is shown once. In the dashboard top bar, select the new project and environment `dev`.

In the React app entry (`main.tsx` or `index.tsx`), before `createRoot`:

```ts
import { startPulseOps } from "<path-to-pulseops>/pulseops-source/packages/sdk-browser/src/index.ts";

startPulseOps({
  url: "http://127.0.0.1:47322",
  apiKey: "<api_key.token>",
  service: "my-react-app",
  env: "dev",
});
```

Use the app, including a slow screen and one that throws. Within about 15 seconds, open PulseOps on the last 15 minutes. Page loads and fetches are on API. Thrown errors are on Errors. Insights lists slow pages and repeated errors.

The key is visible in the browser bundle. Use it for this local scan only.

## Stop

Stop the dashboard and the API with Ctrl+C in each terminal. Then:

```bash
cd infra
docker compose stop timescaledb redis
```
