# PulseOps web

Dark performance dashboard for the shop-api workspace. It ships the overview, services, API performance, resources, errors, alerts, and settings screens on Midnight Aurora tokens. Traces and Insights are labeled coming soon.

The UI talks to `VITE_API_URL` (default `http://127.0.0.1:47322`) and falls back to demo telemetry when that API is down or the payload does not match the dashboard types.

## Run

```bash
cd apps/web
npm install
npm run dev
```

The dev server binds to `0.0.0.0:47321`.

Open http://127.0.0.1:47321 and enter the demo workspace:

- email `demo@pulseops.dev`
- password `pulseops-demo`

Time range, project, and environment live in the URL. `?chaos=1` forces the inline retry state. The `dev` environment is empty so the SDK empty state is visible.

## Scripts

- `npm run dev` — Vite on port 47321
- `npm run typecheck` — project TypeScript build
- `npm run build` — typecheck and production bundle
- `npm run lint` — oxlint
