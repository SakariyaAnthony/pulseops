# Performance Monitoring App — UI & Backend Plan

> **Working name:** PulseOps *(rename freely)*
> **Frontend:** React + TypeScript · **Theme:** Modern dark, glassy, neon-accented
> **Purpose:** Monitor application performance, track response time / resource usage / API health, and surface bottlenecks so developers can optimize faster.

---

## 1. Product Overview

### 1.1 Problem
Developers lack a single place to see *how fast* their app is, *where* it's slow, and *why*. Existing APM tools are heavy and expensive. We want a lean, extensible reference implementation of our own monitoring and optimization tool.

### 1.2 Goals
- Real-time visibility into response time, throughput, error rate, CPU, memory, disk, network.
- Per-endpoint API performance analysis (p50 / p95 / p99, slowest routes, error hotspots).
- Distributed-style request traces with waterfall view to locate slow spans (DB, external API, cache).
- Automatic **bottleneck detection** with human-readable insights and suggested fixes.
- Alerts (threshold + anomaly) with notification channels.
- A stunning, fast, dark UI that developers *enjoy* leaving open on a second monitor.

### 1.3 Non-Goals (v1)
- Full log management / SIEM.
- Mobile-native apps.
- Auto-instrumentation for every language (we start with Node.js, Python, and browser RUM).

### 1.4 Target Users
| Persona | Needs |
|---|---|
| Developer | Find slow endpoints/queries fast, compare before/after a deploy |
| Tech Lead | Health overview, regressions, SLO tracking |
| DevOps / SRE | Resource saturation, alerts, incident timeline |

---

## 2. Scope & Feature Roadmap

### MVP (Phase 1)
- Projects / environments (prod, staging, dev)
- Overview dashboard (KPIs + live charts)
- API performance table + endpoint detail
- Resource usage (CPU, memory, disk, network)
- Error tracking summary
- Basic threshold alerts + email/Slack
- Ingestion SDK for Node.js + Python

### Phase 2
- Distributed traces + waterfall
- Slow DB query analysis
- Bottleneck insights engine
- Deploy markers & before/after comparison
- Browser RUM (Core Web Vitals)

### Phase 3
- Anomaly detection (baseline learning)
- SLO / error budget tracking
- Team roles, SSO, audit log
- Custom dashboards (drag-and-drop widgets)
- Public status page

---

## 3. Tech Stack

### Frontend
| Concern | Choice | Why |
|---|---|---|
| Framework | React 18 + TypeScript + Vite | Fast DX, type safety |
| Styling | Tailwind CSS + CSS variables | Token-driven dark theme |
| Components | shadcn/ui + Radix UI | Accessible, fully customizable primitives |
| Charts | **Apache ECharts** (heavy/time-series) + Recharts (small sparklines) | ECharts handles 100k+ points smoothly |
| Server state | TanStack Query | Caching, refetch, background updates |
| Client state | Zustand | Time range, filters, theme, layout |
| Routing | React Router v6 / TanStack Router | Nested layouts |
| Realtime | Native WebSocket wrapper (reconnect + backoff) | Live metrics |
| Tables | TanStack Table + TanStack Virtual | Large sortable/virtualized tables |
| Motion | Framer Motion | Smooth micro-interactions |
| Icons | Lucide | Consistent, clean |
| Forms | React Hook Form + Zod | Validation |
| Testing | Vitest, React Testing Library, Playwright | Unit + E2E |

### Backend
| Concern | Choice | Why |
|---|---|---|
| API | **FastAPI** (Python) | Async, typed, auto OpenAPI docs, native WebSocket |
| Ingestion | FastAPI endpoint + Redis Streams (upgrade path: Kafka) | Decouples write-heavy traffic |
| Time-series DB | **TimescaleDB** (Postgres extension) — MVP; ClickHouse at scale | SQL, continuous aggregates, retention policies |
| Relational data | PostgreSQL (same cluster) | Users, projects, alerts |
| Cache / PubSub | Redis | Live fan-out, rate limiting, hot aggregates |
| Workers | Celery / ARQ | Alert evaluation, rollups, insights |
| Auth | JWT (access + refresh) + API keys for SDKs | Standard |
| Deploy | Docker Compose → Kubernetes | Simple start, scalable |
| Observability of itself | OpenTelemetry + Prometheus metrics | Dogfooding |

---

## 4. High-Level Architecture

```
 ┌─────────────────────┐        ┌──────────────────────┐
 │  Monitored Apps     │        │   Browser RUM SDK    │
 │  (Node / Python SDK)│        │  (Web Vitals, XHR)   │
 └─────────┬───────────┘        └──────────┬───────────┘
           │  batched HTTPS (gzip, API key) │
           ▼                                ▼
 ┌──────────────────────────────────────────────────────┐
 │                 Ingestion Gateway (FastAPI)          │
 │   auth · validate · rate-limit · enrich · enqueue    │
 └──────────────────────────┬───────────────────────────┘
                            ▼
                   ┌─────────────────┐
                   │  Redis Streams  │
                   └───────┬─────────┘
          ┌────────────────┼─────────────────┐
          ▼                ▼                 ▼
 ┌────────────────┐ ┌───────────────┐ ┌──────────────────┐
 │ Metric Writer  │ │ Trace Writer  │ │ Alert/Insight    │
 │ (batch insert) │ │ (spans)       │ │ Workers          │
 └───────┬────────┘ └──────┬────────┘ └────────┬─────────┘
         ▼                 ▼                   ▼
 ┌──────────────────────────────────────────────────────┐
 │  TimescaleDB (hypertables + continuous aggregates)   │
 │  PostgreSQL (users, projects, alert rules, insights) │
 └──────────────────────────┬───────────────────────────┘
                            ▼
 ┌──────────────────────────────────────────────────────┐
 │  Query API (FastAPI)  +  WebSocket Hub (Redis PubSub)│
 └──────────────────────────┬───────────────────────────┘
                            ▼
 ┌──────────────────────────────────────────────────────┐
 │           React Dashboard (Dark Theme UI)            │
 └──────────────────────────────────────────────────────┘
```

---

## 5. UI Plan

### 5.1 Design Principles
1. **Data first, chrome second** — dark surfaces recede, data glows.
2. **Glanceable** — health of the system understood in under 3 seconds.
3. **Progressive depth** — Overview → Service → Endpoint → Trace → Span.
4. **Calm motion** — subtle transitions, no gratuitous animation.
5. **Keyboard-friendly** — `Cmd/Ctrl + K` command palette, shortcuts for time range.

### 5.2 Visual Identity — "Midnight Aurora"

A deep navy-black base with soft aurora gradients (violet → cyan) and semantic status glows.

#### Color Tokens

| Token | Hex | Usage |
|---|---|---|
| `--bg-base` | `#0A0B14` | App background |
| `--bg-surface` | `#10121F` | Cards, panels |
| `--bg-elevated` | `#171A2C` | Modals, dropdowns, hover |
| `--border-subtle` | `#232741` | Dividers |
| `--border-glow` | `rgba(124,92,255,.35)` | Focus / active cards |
| `--text-primary` | `#EEF0FF` | Headings, key numbers |
| `--text-secondary` | `#9AA0C3` | Labels |
| `--text-muted` | `#5E6490` | Hints, axes |
| `--accent-violet` | `#7C5CFF` | Primary brand / actions |
| `--accent-cyan` | `#22D3EE` | Secondary / response time |
| `--accent-pink` | `#F472B6` | Highlights / p99 |
| `--success` | `#34D399` | Healthy |
| `--warning` | `#FBBF24` | Degraded |
| `--danger` | `#F43F5E` | Critical / errors |
| `--info` | `#60A5FA` | Informational |

**Gradients**
- Brand: `linear-gradient(135deg, #7C5CFF 0%, #22D3EE 100%)`
- Card sheen: `linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,0))`
- Background aurora: two blurred radial gradients (violet top-left, cyan bottom-right) at ~12% opacity behind the layout.

#### Typography
- **UI:** `Inter` (variable) — 14px base
- **Numbers / code / IDs:** `JetBrains Mono` — tabular numerals for metrics
- **Display (KPI values):** Inter 600, 32–40px, tight tracking

#### Shape, Depth & Effects
- Radius: `12px` cards, `8px` inputs/buttons, `999px` pills
- Glass panels: `backdrop-filter: blur(12px)`, 1px `--border-subtle` border
- Elevation: layered shadows + faint inner top highlight (`inset 0 1px 0 rgba(255,255,255,.05)`)
- Status glow: `box-shadow: 0 0 24px -4px <status-color>/40%` on critical KPIs
- Chart gradients: area fills fade from 35% → 0% opacity

#### Tailwind Setup (excerpt)
```ts
// tailwind.config.ts
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: '#0A0B14',
        surface: '#10121F',
        elevated: '#171A2C',
        line: '#232741',
        violet: { DEFAULT: '#7C5CFF' },
        cyan: { DEFAULT: '#22D3EE' },
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#F43F5E',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 32px -6px rgba(124,92,255,.45)',
        card: '0 1px 0 rgba(255,255,255,.05) inset, 0 8px 24px -12px rgba(0,0,0,.6)',
      },
      borderRadius: { xl2: '12px' },
    },
  },
}
```

### 5.3 Application Layout

```
┌────────┬──────────────────────────────────────────────────────┐
│        │  Top bar: Project ▾ · Env ▾ · Time range ▾ · ⌘K ·    │
│  Side  │           Live ● · Refresh · Alerts 🔔 · Avatar       │
│  Nav   ├──────────────────────────────────────────────────────┤
│        │                                                      │
│ ◉ Overview                                                    │
│ ◈ Services          Page content (scrollable)                  │
│ ⌁ API Performance                                              │
│ ⎇ Traces                                                       │
│ ▤ Resources                                                    │
│ ⚠ Errors                                                       │
│ ✦ Insights                                                     │
│ 🔔 Alerts                                                      │
│ ⚙ Settings                                                     │
└────────┴──────────────────────────────────────────────────────┘
```
- Collapsible icon sidebar (64px ↔ 240px), active item has violet left bar + glow.
- Global **time range picker** (Last 15m / 1h / 6h / 24h / 7d / Custom) + **auto-refresh toggle**; state in URL query params so views are shareable.
- **Deploy markers** rendered as vertical dashed lines on every time-series chart.

### 5.4 Screens

#### A. Overview Dashboard
**Goal:** instant system health.

```
┌ KPI ─────┬ KPI ─────┬ KPI ─────┬ KPI ─────┬ KPI ─────┐
│ Avg Resp │ P95      │ Req/min  │ Error %  │ Apdex    │
│ 182 ms ▲ │ 640 ms   │ 12.4k    │ 0.42% ▼  │ 0.96     │
│ sparkline│ sparkline│ sparkline│ sparkline│ gauge    │
└──────────┴──────────┴──────────┴──────────┴──────────┘
┌ Response Time (p50/p95/p99 area chart) ─────┬ Throughput ┐
│                                             │            │
└─────────────────────────────────────────────┴────────────┘
┌ CPU & Memory (dual line) ──┬ Top Slow Endpoints ─┬ Bottleneck
│                            │ table w/ mini bars   │ Insights  │
└────────────────────────────┴──────────────────────┴──────────┘
┌ Service Health Map (status tiles) ┬ Recent Alerts / Incidents ┐
└───────────────────────────────────┴───────────────────────────┘
```
- KPI cards: big mono number, delta vs previous period (▲/▼ colored), sparkline, status glow when breaching threshold.
- Charts support brush-zoom; zooming one chart syncs time range for all.

#### B. Services
- Grid/list of services with health badge, latency, throughput, error rate, instance count.
- Click → Service detail with tabs: *Overview · Endpoints · Dependencies · Resources · Deploys*.
- **Dependency graph** (React Flow): nodes = services/DBs/caches/external APIs; edge thickness = traffic, edge color = latency/error health.

#### C. API Performance
- Virtualized table: Method · Route · Calls · Avg · p95 · p99 · Error % · Apdex · Trend sparkline.
- Filters: method, status class, service, min latency; saved views.
- Column sort, search, row click → **Endpoint Detail**.

**Endpoint Detail**
- Header: `GET /api/orders/:id` with health pill.
- Latency distribution **histogram** + percentile lines.
- Status-code breakdown (donut), throughput over time.
- Time-spent breakdown: *App code / DB / Cache / External HTTP* (stacked bar).
- Slowest traces list → opens Trace view.
- Before/after deploy comparison toggle.

#### D. Traces
- Search by trace ID, route, status, duration > X.
- **Waterfall view:** nested spans, color-coded by type (HTTP violet, DB cyan, cache green, external pink), duration bars with critical-path highlight.
- Side drawer for span metadata (SQL, headers, error stack).

#### E. Resources
- CPU, memory, disk I/O, network in/out, event-loop lag / GC pauses, open connections.
- Per-host/container selector, heatmap of CPU across instances.
- Threshold bands shaded on charts (warning/critical).

#### F. Errors
- Grouped errors by fingerprint: message, count, first/last seen, affected users, trend.
- Detail with stack trace, request context, linked traces.

#### G. Insights (Bottleneck Detection)
Card feed, sorted by severity & impact:
> 🔴 **N+1 query detected** on `GET /api/orders` — 47 identical queries per request, adds ~420 ms. *Suggestion: batch with a JOIN or dataloader.*
> 🟠 **Memory climbing** on `worker-3` — +3.2%/hr for 6h, possible leak.
> 🟡 **Slow external dependency** `payments.example.com` p95 1.8 s, 38% of checkout time.

Each card: impact estimate, evidence chart, affected endpoints, "View traces", "Create alert", "Dismiss/Snooze".

#### H. Alerts
- Rules list (metric, condition, window, severity, channels, status toggle).
- Rule builder: metric → condition → threshold → duration → notify (Email, Slack, Webhook).
- Incident timeline with acknowledge/resolve and notes.

#### I. Settings
- Projects & environments, API keys (copy/rotate), team members & roles, notification channels, data retention, theme density.

### 5.5 Component Inventory

| Category | Components |
|---|---|
| Layout | `AppShell`, `Sidebar`, `TopBar`, `PageHeader`, `AuroraBackground` |
| Data display | `KpiCard`, `Sparkline`, `StatusBadge`, `DeltaChip`, `GaugeApdex`, `MetricTile` |
| Charts | `TimeSeriesChart`, `HistogramChart`, `HeatmapChart`, `StackedBar`, `DonutChart`, `DependencyGraph`, `TraceWaterfall` |
| Tables | `DataTable` (virtualized, sortable, column picker), `EndpointRow`, `ErrorGroupRow` |
| Inputs | `TimeRangePicker`, `EnvSwitcher`, `FilterBar`, `CommandPalette`, `SearchInput` |
| Feedback | `Toast`, `EmptyState`, `Skeleton`, `ErrorBoundary`, `LiveIndicator` |
| Overlays | `Drawer` (span/error detail), `Modal`, `Tooltip`, `Popover` |

### 5.6 States & Polish
- **Loading:** shimmer skeletons matching final layout (no spinners on dashboards).
- **Empty:** illustrated empty states with "Install the SDK" quickstart snippet.
- **Error:** inline retry, never blank screens.
- **Live indicator:** pulsing green dot; new data points animate in smoothly.
- **Chart tooltips:** synced crosshair across all charts on a page.
- **Accessibility:** WCAG AA contrast on all text, focus rings in violet, reduced-motion support, color-blind-safe secondary encodings (icons/patterns beside color).
- **Responsive:** desktop-first; tablet collapses sidebar; mobile shows KPI + alerts only.

### 5.7 Frontend Architecture

```
src/
├─ app/                 # providers, router, query client, theme
├─ components/
│  ├─ ui/               # shadcn primitives (button, card, dialog…)
│  ├─ charts/           # ECharts wrappers, theme, sparkline
│  ├─ layout/
│  └─ shared/
├─ features/
│  ├─ overview/
│  ├─ services/
│  ├─ api-performance/
│  ├─ traces/
│  ├─ resources/
│  ├─ errors/
│  ├─ insights/
│  ├─ alerts/
│  └─ settings/
├─ hooks/               # useTimeRange, useLiveMetrics, useDebounce
├─ lib/                 # api client, ws client, formatters, echarts theme
├─ store/               # zustand slices (filters, timeRange, ui)
├─ types/
└─ styles/              # globals.css (tokens), aurora.css
```

**Key patterns**
- `useLiveMetrics(channel)` — subscribes to WebSocket, merges incoming points into TanStack Query cache.
- Charts use a shared ECharts dark theme registered once (`echarts.registerTheme('aurora', …)`).
- Large series downsampled server-side (LTTB / bucketed aggregates); UI requests `resolution` based on time range & pixel width.
- Route-level code splitting + lazy-loaded chart bundles.
- Number/duration formatters centralized (`182 ms`, `1.4 s`, `12.4k`).

---

## 6. Backend Plan

### 6.1 Metrics & Data Collected

| Category | Metrics |
|---|---|
| **Request** | route, method, status, duration, size, user-agent, trace ID |
| **Latency stats** | avg, p50, p90, p95, p99, max, Apdex |
| **Throughput** | requests/min, per route/service |
| **Errors** | count, rate, type, message, stack, fingerprint |
| **Resources** | CPU %, memory RSS/heap, disk I/O, network I/O, load avg, open FDs/connections |
| **Runtime** | event-loop lag, GC time, thread/worker pool usage |
| **Database** | query text (normalized), duration, rows, connection pool wait |
| **External calls** | host, duration, status |
| **Deploys** | version, commit SHA, timestamp |
| **Browser RUM** | LCP, INP, CLS, TTFB, JS errors |

### 6.2 Instrumentation SDKs
- **Node.js** — Express/Fastify/Nest middleware + `perf_hooks`, `process.memoryUsage`, patched `http`/`pg`/`mysql`/`redis`.
- **Python** — ASGI/WSGI middleware (FastAPI, Django, Flask), `psutil`, SQLAlchemy event hooks, `httpx`/`requests` wrappers.
- **Browser** — `web-vitals` + `PerformanceObserver` + fetch/XHR wrapper.
- Common behavior: in-memory buffer → batched gzip POST every 5–10 s, sampling (e.g., 100% errors, 10% traces), never block the host app, fail silent with local backoff.
- Optional **OpenTelemetry (OTLP) endpoint** so any OTel-instrumented app can send data.

### 6.3 Ingestion Pipeline
1. `POST /ingest/v1/metrics|spans|errors|events` with `X-API-Key`.
2. Gateway validates schema (Pydantic), checks per-key rate limits (Redis token bucket), enriches (project, env, geo/IP optional).
3. Push to **Redis Streams**; return `202 Accepted` immediately.
4. Consumer groups batch-write to TimescaleDB (`COPY` / multi-row insert every 1 s or 5k rows).
5. Publish rolled-up "live" snapshots to Redis PubSub → WebSocket hub → dashboard.

### 6.4 Storage Design

**Hypertables (TimescaleDB)**
```sql
-- Request-level metrics (raw, short retention)
CREATE TABLE request_metrics (
  time         TIMESTAMPTZ NOT NULL,
  project_id   UUID NOT NULL,
  env          TEXT NOT NULL,
  service      TEXT NOT NULL,
  host         TEXT,
  method       TEXT NOT NULL,
  route        TEXT NOT NULL,
  status_code  SMALLINT NOT NULL,
  duration_ms  REAL NOT NULL,
  trace_id     TEXT,
  version      TEXT
);
SELECT create_hypertable('request_metrics', 'time');
CREATE INDEX ON request_metrics (project_id, service, route, time DESC);

-- Resource metrics
CREATE TABLE resource_metrics (
  time TIMESTAMPTZ NOT NULL, project_id UUID NOT NULL, env TEXT,
  service TEXT, host TEXT,
  cpu_pct REAL, mem_rss_mb REAL, heap_used_mb REAL,
  disk_read_bps BIGINT, disk_write_bps BIGINT,
  net_in_bps BIGINT, net_out_bps BIGINT,
  event_loop_lag_ms REAL, gc_pause_ms REAL
);
SELECT create_hypertable('resource_metrics', 'time');

-- Spans for traces
CREATE TABLE spans (
  time TIMESTAMPTZ NOT NULL, project_id UUID NOT NULL,
  trace_id TEXT NOT NULL, span_id TEXT NOT NULL, parent_id TEXT,
  service TEXT, name TEXT, kind TEXT,        -- http | db | cache | external | internal
  duration_ms REAL, status TEXT, attributes JSONB
);
SELECT create_hypertable('spans', 'time');
CREATE INDEX ON spans (trace_id);

-- Errors
CREATE TABLE error_events (
  time TIMESTAMPTZ NOT NULL, project_id UUID NOT NULL,
  fingerprint TEXT NOT NULL, type TEXT, message TEXT,
  stack TEXT, route TEXT, trace_id TEXT, context JSONB
);
SELECT create_hypertable('error_events', 'time');
```

**Continuous aggregates (rollups)**
```sql
CREATE MATERIALIZED VIEW request_metrics_1m
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', time) AS bucket,
       project_id, env, service, method, route,
       count(*)                                   AS calls,
       avg(duration_ms)                           AS avg_ms,
       percentile_agg(duration_ms)                AS pct_state,   -- approx_percentile(0.95, pct_state)
       count(*) FILTER (WHERE status_code >= 500) AS errors
FROM request_metrics
GROUP BY bucket, project_id, env, service, method, route;
-- Repeat for 1h and 1d rollups
```

**Retention policy**
| Data | Retention |
|---|---|
| Raw requests / spans | 7 days |
| 1-min rollups | 30 days |
| 1-hour rollups | 1 year |
| 1-day rollups | 3 years |
| Errors | 30 days (configurable) |

**Relational tables (PostgreSQL):** `users`, `organizations`, `memberships`, `projects`, `environments`, `api_keys`, `alert_rules`, `alert_incidents`, `notification_channels`, `insights`, `deploys`, `saved_views`.

### 6.5 Query API (FastAPI)

**Auth:** `Authorization: Bearer <JWT>` for the UI, `X-API-Key` for ingestion. All endpoints are scoped by `project_id`.

| Area | Endpoint | Description |
|---|---|---|
| Auth | `POST /auth/login`, `/auth/refresh`, `/auth/logout` | Session handling |
| Projects | `GET/POST /projects`, `GET /projects/{id}` | Project CRUD |
| Overview | `GET /projects/{id}/overview?range=1h` | KPIs + sparklines + deltas |
| Metrics | `GET /projects/{id}/metrics/timeseries` | `metric`, `agg`, `group_by`, `from`, `to`, `resolution` |
| Services | `GET /projects/{id}/services` | List + health |
| | `GET /projects/{id}/services/{svc}` | Detail |
| | `GET /projects/{id}/dependency-graph` | Nodes + edges |
| Endpoints | `GET /projects/{id}/endpoints` | Table data (sort/filter/paginate) |
| | `GET /projects/{id}/endpoints/{key}` | Detail: percentiles, histogram, breakdown |
| Traces | `GET /projects/{id}/traces` | Search |
| | `GET /projects/{id}/traces/{trace_id}` | Spans for waterfall |
| Resources | `GET /projects/{id}/resources` | Host/container series |
| Errors | `GET /projects/{id}/errors`, `/errors/{fingerprint}` | Groups + detail |
| Insights | `GET /projects/{id}/insights`, `PATCH /insights/{id}` | Feed, dismiss/snooze |
| Alerts | `CRUD /projects/{id}/alert-rules`, `GET /incidents`, `POST /incidents/{id}/ack` | Alerting |
| Deploys | `POST /deploys` (API key), `GET /projects/{id}/deploys` | Deploy markers |
| Ingest | `POST /ingest/v1/{metrics,spans,errors,events}` | SDK endpoints |

**Example response — timeseries**
```json
{
  "metric": "response_time",
  "resolution": "1m",
  "series": [
    {
      "name": "p95",
      "points": [[1739800000000, 642.1], [1739800060000, 655.4]]
    }
  ],
  "deploys": [{ "time": 1739800900000, "version": "v2.14.1" }]
}
```

### 6.6 Realtime (WebSocket)
`GET /ws?project_id=…&token=…`

| Event (server → client) | Payload |
|---|---|
| `metrics.snapshot` | Latest 1-5 s aggregates (RPS, avg/p95, error %, CPU, mem) |
| `alert.triggered` / `alert.resolved` | Incident object |
| `insight.created` | Insight card |
| `deploy.created` | Deploy marker |

Client → server: `subscribe` / `unsubscribe` to channels (`overview`, `service:{name}`, `alerts`).
Fan-out via Redis PubSub so multiple API pods share one stream. Heartbeat ping every 25 s; client auto-reconnects with exponential backoff and refetches missed window via REST.

### 6.7 Bottleneck Detection Engine
Runs as scheduled workers (every 1–5 min) over rollups and recent traces.

| Detector | Logic | Insight |
|---|---|---|
| **Slow endpoint** | p95 > SLO or > 2× 7-day baseline | "Endpoint regressed by X%" |
| **N+1 queries** | Same normalized SQL ≥ N times inside one trace | "N+1 on route Y" |
| **Slow query** | DB span p95 > threshold, high total time share | "Query Z costs X% of request time" |
| **Slow dependency** | External span share of request time > 30% | "Dependency is your bottleneck" |
| **Resource saturation** | CPU > 85% / mem > 90% sustained 5 min | "Host nearing saturation" |
| **Memory leak** | Linear regression on heap slope positive over 3–6 h | "Possible leak" |
| **Event-loop blocking** | Lag > 100 ms frequent | "Blocking sync work" |
| **Error spike** | Error rate z-score > 3 vs baseline | "Error surge after deploy" |
| **Post-deploy regression** | Compare 30 min before/after deploy markers | "v2.14.1 slowed route X" |

Each insight stores: `severity`, `impact_ms`, `affected_routes`, `evidence` (JSON for chart), `suggestion`, `status`.

### 6.8 Alerting
- Rule = `metric + aggregation + operator + threshold + window + severity + channels`.
- Evaluator worker runs every 30 s using rollups; uses *for-duration* + hysteresis to avoid flapping.
- Incident lifecycle: `firing → acknowledged → resolved`.
- Channels: Email, Slack webhook, generic Webhook (PagerDuty/MS Teams later).
- Anomaly rules (Phase 3): rolling median/MAD or seasonal baseline.

### 6.9 Security & Multi-Tenancy
- Org → Project → Environment isolation enforced in every query (`project_id` mandatory, row-level checks).
- Hashed API keys (shown once), scoped & revocable; JWT with short expiry + refresh rotation.
- Rate limiting and payload size caps on ingestion; schema validation; PII scrubbing rules (strip query strings, mask headers like `Authorization`, configurable redaction).
- RBAC: Owner / Admin / Developer / Viewer.
- TLS everywhere, secrets in env/secret manager, audit log for config changes.

### 6.10 Performance & Scalability of the Tool Itself
- Write path: batching + async consumers; horizontal scale by adding consumers.
- Read path: dashboards read **rollups**, not raw tables; short-TTL Redis cache (5–15 s) for overview queries.
- Max points per chart ≈ 600–1,000 (server picks resolution).
- Partition/shard plan: TimescaleDB multi-node or migrate metric/span tables to ClickHouse when ingest > ~50k events/s.
- Backpressure: Redis stream length caps + sampling advice returned to SDK in the ingest response.

---

## 7. Delivery Roadmap

| Phase | Weeks | Deliverables |
|---|---|---|
| **0 – Foundations** | 1 | Repo setup, design tokens, Tailwind + shadcn theme, app shell, CI, Docker Compose (Postgres/Timescale, Redis) |
| **1 – Core Backend** | 2–3 | Auth, projects, API keys, ingestion endpoints, Redis Streams, writers, hypertables, rollups |
| **2 – Core UI** | 3–5 | Overview dashboard, API performance table + endpoint detail, resources page, time range & live updates |
| **3 – SDKs** | 5–6 | Node + Python SDKs, quickstart docs, demo app generating load |
| **4 – Errors & Alerts** | 6–7 | Error grouping, alert rules, incidents, Slack/email |
| **5 – Traces & Insights** | 8–10 | Span ingestion, waterfall UI, dependency graph, bottleneck detectors, insights feed |
| **6 – Hardening** | 11–12 | Load tests, security review, RUM SDK, docs, polish & accessibility pass |

**Milestone demo:** a sample e-commerce app instrumented with the SDK, driven by a load generator (k6), with an intentionally injected N+1 query and a leaky worker so the Insights page detects both.

---

## 8. Testing & Quality

| Layer | Approach |
|---|---|
| Frontend unit | Vitest + RTL for components and hooks |
| Visual | Storybook + Chromatic/Playwright screenshots for dark theme consistency |
| E2E | Playwright: login → dashboard → drill-down → create alert |
| Backend unit/integration | pytest + testcontainers (Timescale, Redis) |
| Load | k6 / Locust against ingestion (target: 10k events/s on a single node) |
| Contract | OpenAPI schema → generated TS client (`openapi-typescript`) to keep UI/API in sync |
| Accessibility | axe-core in CI, manual keyboard pass |

---

## 9. DevOps

- **Environments:** local (Docker Compose) → staging → production.
- **CI/CD:** GitHub Actions — lint, typecheck, test, build images, deploy.
- **Monitoring the monitor:** Prometheus + Grafana (or self-dogfood), health endpoints `/healthz` & `/readyz`.
- **Migrations:** Alembic.
- **Backups:** daily Postgres snapshots; WAL archiving.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| High-volume ingestion overwhelms DB | Redis buffering, batching, sampling, rollups, ClickHouse migration path |
| Slow dashboards on large ranges | Continuous aggregates, server-side downsampling, caching |
| SDK overhead affects host apps | Async batching, sampling, circuit breaker, benchmarks in CI |
| Alert fatigue | For-duration, hysteresis, grouping, snooze, severity tuning |
| Sensitive data leakage | Default redaction, allow-lists, no request bodies captured by default |
| Scope creep | Strict MVP; Phase 2/3 gated by usage feedback |

---

## 11. Immediate Next Steps

1. Approve name, color palette, and MVP scope.
2. Scaffold repo: `apps/web` (Vite + React + TS), `apps/api` (FastAPI), `packages/sdk-node`, `packages/sdk-python`, `infra/docker`.
3. Build the **design system + app shell + Overview dashboard** with mock data first (fastest way to lock in the "wow" look).
4. Stand up Timescale + Redis, implement ingestion + first rollup, replace mocks with live data.
5. Ship the Node SDK and the demo app for end-to-end validation.

---

*End of plan.*
