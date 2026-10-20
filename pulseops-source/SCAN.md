# Scan a React app with PulseOps

PulseOps has no New project button. Create the project with the commands below, paste the API key into the React app, then read the report in the dashboard.

Use three terminals: one for the API, one for the PulseOps dashboard, one for the React app you want to scan.

## 1. Start the databases

From `pulseops-source/infra`:

```bash
docker compose up -d timescaledb redis
docker compose ps
```

Wait until TimescaleDB and Redis are healthy.

## 2. Start the API

From `pulseops-source/apps/api`.

First time only:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
python -m app.seed
```

Every time, including after a CORS change:

```bash
. .venv/bin/activate
python -m app
```

If an older API is already running, stop it with Ctrl+C in that terminal, then run `python -m app` again. The API listens on http://127.0.0.1:47322.

Check it:

```bash
curl -s http://127.0.0.1:47322/healthz
```

`db` and `redis` should both be true.

## 3. Start the PulseOps dashboard

From `pulseops-source/apps/web`:

```bash
npm install
npm run dev
```

If the dashboard is already running, stop it with Ctrl+C and start it again. The browser must load this version. It calls `/api` on the dashboard itself, and Vite forwards that to the API, so the dashboard no longer makes a cross-origin call to port 47322.

Open http://127.0.0.1:47321

Sign in:

- Email: `demo@pulseops.dev`
- Password: `pulseops-demo`

The sidebar should say **Live API**. The seeded project `shop-api` is demo traffic. Leave it and create a separate project for your React app.

## 4. Create a project and copy the key

The dashboard cannot create a project. Run this from any directory while the API is up:

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

The response looks like this:

```json
{
  "project": { "slug": "my-react-app", "name": "My React app" },
  "api_key": {
    "prefix": "po_live_AbCd",
    "token": "po_live_AbCdEfGhIjKlMnOpQrStUvWxYz012345"
  }
}
```

Copy the `token` value. It is the long string that starts with `po_live_` and is about 40 characters. Paste that string into the React app. The word `token` is only the field name. A short value such as `po_live_25e2dfe5349bfaceb747` is a prefix, and the API answers `{"detail":"Invalid API key"}`.

The full token is shown only in this response. If you lose it, run the create command again with a new name.

The only key already in a fresh database is the demo key `po_live_shop_api_demo_key`. That key writes into `shop-api`. Use a new project for the React app.

## 5. Add the snippet to the React app

Copy this file into the React app:

`pulseops-source/packages/sdk-browser/src/index.ts`

Save it as `src/pulseops.ts` inside the React app. An import that points outside the React project is blocked by Vite.

In `src/main.tsx` (or `src/index.tsx`), before `createRoot`:

```ts
import { startPulseOps } from "./pulseops";

startPulseOps({
  url: "http://127.0.0.1:47322",
  apiKey: "po_live_paste_the_full_token_here",
  service: "my-react-app",
  env: "dev",
});
```

`env` must be `"dev"`. That is the environment you will select in the dashboard.

Restart the React dev server, then open the React app in the browser and click through a few pages. Open one slow page and one page that throws, if you have them. The snippet sends a batch about every 5 seconds.

In the browser Network tab, `POST http://127.0.0.1:47322/ingest/v1/metrics` should return 202. A 401 body of `{"detail":"Invalid API key"}` means the `apiKey` string is not the full token from step 4.

## 6. Read the report

In PulseOps, set the top bar to:

- Project: **My React app** (slug `my-react-app`)
- Environment: **dev**
- Range: **15m**

Then open:

| Page | What you should see |
| --- | --- |
| Overview | Request rate and response time for the pages you opened |
| API | Routes named `page:/...` for page loads, plus each `fetch` URL |
| Errors | JavaScript errors thrown in the React app |
| Insights | Slow pages and repeated errors, after a page is slow or an error happens more than once |
| Resources | Empty for a browser scan. This page is for host CPU and memory |

Give the first batch up to 15 seconds. If the range is still empty, stay on `dev` and `15m`, use the React app again, and refresh PulseOps.

## If the dashboard still shows CORS

1. Stop the dashboard terminal and run `npm run dev` again from `apps/web`.
2. Open http://127.0.0.1:47321, not a LAN address such as `http://192.168.x.x:47321`.
3. In the Network tab, dashboard calls should go to `http://127.0.0.1:47321/api/...`. A call straight to `http://127.0.0.1:47322/incidents` means the old dashboard bundle is still loaded.

The React app still calls port 47322. That is expected. Restart the API from step 2 if those ingest calls fail the browser’s private-network check.

## 7. Lab scan

A lab scan reads a local repository and, optionally, opens its pages in Chromium. It does not write into the live Overview, API, or Errors pages. Those pages stay on the SDK traffic from the steps above.

From `apps/api`, apply the scan tables and install the scanner libraries. If the virtualenv is not writable, the `--target .vendor` form puts them where the API loads them:

```bash
. .venv/bin/activate
alembic upgrade head
python -m pip install --target .vendor playwright tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-css tree-sitter-html
PYTHONPATH=.vendor .venv/bin/python -m playwright install chromium
```

A repository path is allowed when it is inside your home directory. The API uses that default even when it is started with sudo. To allow a different folder, set `PULSEOPS_SCAN_ROOTS` in `apps/api/.env` and restart `python -m app`. A shell export is not visible to a process started with sudo.

In the dashboard, open Settings for the project and save:

- Repository path: the absolute path of the React app
- Base URL: `http://127.0.0.1:` plus the React app port
- Routes: one path per line, such as `/` and `/checkout`
- Start command: stored only. PulseOps does not run it

Open Scans.

- Static assets walks the repo, skips `node_modules`, `dist`, and secret files, and classifies references.
- Browser opens the routes and records lab page metrics and API calls.
- Full does both.

The Scans page shows setup as a one-line summary. Use **Edit setup** to change the repository path, base URL, and routes. Pick a mode card, then **Run scan**. A mode is disabled until its setting is filled in.

After a scan, the asset insights show:

- Total assets, with size on disk and size loaded in the browser.
- Potentially unused files, with the size you could reclaim.
- Large images (over 200 KB) and videos (over 1 MB). High means over 1 MB for an image or 5 MB for a video.
- Failed requests: images, media, fonts, and stylesheets that did not load on a tested route, including files that are not in the repository.
- Quality issues: low resolution (under 200 px), heavy JPEG compression, and dimensions over 2400 px. These are hints to check.
- Duplicate files, slow downloads (1 second or more), and source references to files that do not exist.

A runtime-only scan has no repository to compare with, so it lists the assets the routes requested and their failures. Static-only checks (unused, duplicates, dimensions) need a static or full scan.

Potentially unused means the parser and the tested routes did not see the file. It is not a request to delete it. p95 is blank until an endpoint has at least 5 samples. p99 is blank until it has at least 20. A browser failure stays on the scan and does not appear as live SDK traffic.
