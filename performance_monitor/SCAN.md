# Scan a React app with PulseOps

One project per app. The same project holds the asset scan and the API performance report. Create it once in the dashboard, scan its assets, then capture its API calls. Live traffic from the SDK is optional.

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

## 4. Create the project (once per app)

In the dashboard open Assets, click **Edit setup**, choose **New project**, and fill in the repository path and base URL. The project name is filled in from the folder name, and the new project is selected for you. You can also pick **+ New project** at the bottom of the project dropdown in the top bar.

Names must be unique. Creating a name that already exists answers "A project named ... already exists", so use the existing project or delete it first (Settings, Delete project).

When the project is created, PulseOps shows its API key and the snippet once. You can skip it: the asset scan and **Capture API calls** need no key and no code in your app. To get a key later, open Settings and press **Generate new key**. The old key stops working and the full new key is shown once.

A short value such as `po_live_25e2dfe5349bfaceb747` is only a prefix. The full key is about 40 characters. The API answers `{"detail":"Invalid API key"}` to a prefix.

The seeded `shop-api` project is demo traffic with the demo key `po_live_shop_api_demo_key`. Use a new project for your own app.

## 4b. Capture API calls (no code in your app)

Start your React app so it answers at the base URL. PulseOps does not start it for you, and the start command is only stored.

Open API and choose **App capture**, then press **Capture API calls**. PulseOps opens the base URL in Chromium, visits the routes in your setup, and records the API calls the app makes. Each route shows calls, average, p95 (needs 5 samples), p99 (needs 20), error rate, and Apdex. The Services page shows one service for the project, built from the same capture.

A capture is a snapshot of that run, not live traffic. Press the button again after you change the app. If the capture fails, check that the app is running at the base URL. Calls to public hosts such as a third-party API are recorded. Calls to localhost, private network addresses, and hosts that do not resolve are blocked.

## 5. Optional: live traffic with the SDK

This step shows real traffic as you use the app, including throughput. Settings has a **Connect live traffic** panel with the same snippet and your service name filled in.

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

In the browser Network tab, `POST http://127.0.0.1:47322/ingest/v1/metrics` should return 202. A 401 body of `{"detail":"Invalid API key"}` means the `apiKey` string is not the full key. Generate a new one in Settings.

## 6. Read the report

In PulseOps, set the top bar to:

- Project: your app's project
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

A lab scan reads a local repository and, optionally, opens its pages in Chromium. It does not write into the live Overview or Errors pages. The API page reads a runtime scan through **App capture** (step 4b). The live view stays on SDK traffic.

From `apps/api`, apply the scan tables and install the scanner libraries. If the virtualenv is not writable, the `--target .vendor` form puts them where the API loads them:

```bash
. .venv/bin/activate
alembic upgrade head
python -m pip install --target .vendor playwright tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-css tree-sitter-html
PYTHONPATH=.vendor .venv/bin/python -m playwright install chromium
```

A repository path is allowed when it is inside your home directory. The API uses that default even when it is started with sudo. To allow a different folder, set `PULSEOPS_SCAN_ROOTS` in `apps/api/.env` and restart `python -m app`. A shell export is not visible to a process started with sudo.

In the dashboard, open Assets and click **Edit setup**. **Save to** shows which project the setup goes to. Choose **New project** to scan a different app without changing the current one. If you change the repository path of the current project, a notice says it replaces the old setup. Fill in:

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

## 8. Web Vitals: real users and lab audits

The **Web Vitals** page (sidebar, under Monitor) answers "how fast do pages load and respond?" with two sources that are never merged:

| Tab | Source | What it shows |
| --- | --- | --- |
| Field | The browser SDK, from real visits | LCP, INP, CLS, FCP and TTFB at the 75th percentile, per route, split by device and by first load versus navigation inside the app. Also load time, transferred bytes, requests and long tasks |
| Lab | Lighthouse, run on demand | Score, LCP, Total Blocking Time, CLS, FCP, TTFB, transfer size and requests per route, once as mobile and once as desktop, plus the likely cause of anything slow |

A synthetic test can reproduce a bottleneck. Real users show how the app is actually experienced. When the two disagree, trust the field numbers and use the lab to find out why.

### Field data

1. Install the library the SDK uses, in the React app: `npm install web-vitals`. Then copy the newer `packages/sdk-browser/src/index.ts` into the app as in step 5. Settings shows the matching snippet.
2. Open a few pages. Vitals are batched and sent to `/ingest/v1/vitals` about every 5 seconds and when the tab is hidden.
3. Open Web Vitals. A percentile appears only after **20 samples**. Below that the page shows a dash, because the 75th percentile of a handful of visits is noise.

Notes:

- `vitals: false` turns collection off. `sampleRate: 0.25` reports one visit in four.
- Only the path is stored. Query strings and fragments are dropped before sending and again on the server.
- LCP, FCP and TTFB belong to the route where the visit started. INP and CLS cover the whole visit, so each is attributed to the route that was showing when the slow interaction or the shift happened.
- Navigation inside a single-page app has no LCP in the `web-vitals` library, so those visits contribute load time, requests and long tasks, but not LCP.
- The device is mobile, tablet or desktop, from the browser's mobile hint or the screen width.

### Lab audit

Lighthouse is installed once, separately from the Python packages:

```bash
cd apps/api/tools/lighthouse
npm install
```

It uses the Chromium that Playwright installed (step 7). If it cannot find it, set `PULSEOPS_CHROME_PATH` in `apps/api/.env`. `PULSEOPS_LIGHTHOUSE_BIN` points at a different Lighthouse binary.

Set the base URL and routes (step 4), start the app, then open Web Vitals, choose the **Lab** tab and click **Run Web Vitals audit**. It audits every route as mobile and as desktop, one at a time, and can be cancelled. Each route and device takes roughly 15 to 30 seconds.

Lighthouse starts its own Chrome, so unlike the runtime scan it does not apply the request filter that blocks private hosts. The base URL is still limited to the app address you configured.

Lighthouse does not measure INP. The lab table shows Total Blocking Time (TBT) instead, which is what Lighthouse uses as its responsiveness stand-in.

### Route diagnosis

Selecting a route shows the real-user splits next to the lab findings. Findings come from fixed rules over the Lighthouse report and always quote their evidence:

- Large hero image: the LCP image is large (flagged from 200 KB).
- Blocking API request: a fetch or XHR took 500 ms or more.
- Long JavaScript task: blocking time of 200 ms or more.
- Render-blocking resources: CSS or scripts that delay first paint.
- Layout shift: CLS of 0.1 or more, with the elements involved.
- Slow server response: TTFB of 600 ms or more.

The thresholds for good, needs improvement and poor are the standard web-vitals limits: LCP 2.5 s and 4 s, INP 200 ms and 500 ms, CLS 0.1 and 0.25, FCP 1.8 s and 3 s, TTFB 800 ms and 1.8 s.
