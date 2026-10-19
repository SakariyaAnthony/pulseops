# PulseOps

PulseOps is a local performance monitor for a React app. The dashboard shows live traffic from a browser snippet, and an Asset Intelligence Scanner reads a repository and opens its routes in Chromium.

## What you get

**Live monitor.** The browser snippet posts page loads, `fetch` and XHR calls, and JavaScript errors. The dashboard shows them on Overview, API, Errors, and Insights. Seeded shop traffic is available on the `shop-api` project so the screens have data before you connect an app.

**Asset Intelligence Scanner.** Open **Assets** in the sidebar. A static scan walks the repository and records images, SVG, video, audio, fonts, icons, sizes, hashes, and source references. A runtime scan opens the routes you list and records transfer size, duration, and failed asset loads. A full scan does both. An asset that one pass did not see is marked potentially unused. PulseOps does not delete files.

## Layout

| Path | Role |
| --- | --- |
| `apps/web` | React dashboard (Vite, port 47321) |
| `apps/api` | FastAPI service (port 47322) |
| `packages/sdk-browser` | Browser snippet copied into the app you want to watch |
| `infra` | TimescaleDB and Redis |

TimescaleDB stores request and error series. Redis is used for live updates, rate limits, and refresh-token replay. Lab scan results are stored in their own tables and are not mixed into live traffic.

## Run

You need Docker, Python 3.11+, and Node.js 20+.

From `infra`:

```bash
docker compose up -d timescaledb redis
```

From `apps/api`:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
python -m app
```

From `apps/web`:

```bash
npm install
npm run dev
```

Open http://127.0.0.1:47321 and sign in:

- Email: `demo@pulseops.dev`
- Password: `pulseops-demo`

The sidebar says **Live API** when the API health check succeeds. The seeded project is `shop-api`, environment `prod`. Its ingest key is `po_live_shop_api_demo_key`.

Step-by-step startup is in [RUN.md](RUN.md). Connecting your own React app, including the snippet and API key, is in [SCAN.md](SCAN.md).

## Asset scan

On **Assets**, save the absolute repository path, a `http://127.0.0.1` or `http://localhost` base URL, and the routes to open. The start command is stored and is not executed. The repository must be inside your home directory unless you set `PULSEOPS_SCAN_ROOTS` in `apps/api/.env` and restart the API.

Runtime scans need Chromium:

```bash
cd apps/api
python -m pip install --target .vendor playwright tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-css tree-sitter-html
PYTHONPATH=.vendor .venv/bin/python -m playwright install chromium
```

Restart `python -m app` after installing those packages or changing scan settings.

## Tests

With TimescaleDB and Redis running, from `apps/api`:

```bash
pytest
```

From `apps/web`:

```bash
npm run typecheck
```
