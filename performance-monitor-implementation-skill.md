---
name: performance-monitor-implementation
description: A reusable implementation skill for extending an existing React and FastAPI Performance Monitor with repository scanning, asset intelligence, API performance analysis, React render profiling, page metrics, and actionable recommendations.
---

# Performance Monitor Implementation Skill

## Purpose

Extend an existing **React + Python FastAPI Performance Monitor** into a unified performance analysis platform that analyzes both:

1. A target project's source repository and build artifacts.
2. A running website through automated browser tests and optional runtime telemetry.

The platform must connect static analysis with runtime evidence so developers can understand **what is slow, where it occurs, why it may be happening, how to investigate it, and how to verify a fix**.

Treat this document as an implementation guide for an AI coding agent or developer working in the existing codebase. Inspect the current project first and preserve existing working architecture, conventions, dependencies, authentication, database, and UI patterns unless a change is justified.

---

## 1. Core principles

- Extend the existing application; do not rebuild it without a clear reason.
- Separate source analysis, browser instrumentation, metric aggregation, findings, and presentation.
- Store raw observations separately from aggregates and recommendations.
- Distinguish confirmed facts from suspected root causes.
- Do not label every React render as unnecessary.
- Do not classify an asset as unused based on one scan or one route alone.
- Keep synthetic lab-test data separate from real-user monitoring data.
- Use reproducible scan configurations, source commit identifiers, timestamps, and environment metadata.
- Start with deterministic, testable rules. Add AI-generated explanations only after reliable evidence is available.
- Do not automatically modify or delete target-project files without explicit approval.
- Protect source code, repository credentials, browser sessions, and telemetry from accidental disclosure.

## 2. Target architecture

```text
Target project
├── Git repository / local source directory
├── Build artifacts and dependency metadata
└── Running website
    |
    +--> Static Analysis Engine
    |    ├── Asset inventory
    |    ├── Source-reference graph
    |    ├── Duplicate-content candidates
    |    ├── Potentially unused assets
    |    └── Bundle and dependency analysis
    |
    +--> Runtime Analysis Engine
    |    ├── Browser resource timings
    |    ├── API request timings and failures
    |    ├── Core Web Vitals
    |    ├── Long tasks and navigation timing
    |    └── Opt-in React profiling
    |
    v
Correlation and Analysis Engine
    ├── Map routes to assets, API calls, and components
    ├── Aggregate measurements
    └── Compare scans and source revisions
    |
    v
Findings and Recommendation Engine
    ├── Evidence
    ├── Severity and confidence
    ├── Likely cause
    ├── Recommended fix
    └── Verification procedure
    |
    v
React dashboard
├── Overview
├── Assets
├── API Performance
├── Component Profiler
├── Page Performance
├── Recommendations
└── Scan History
```

### Suggested technology choices

| Layer | Recommendation |
|---|---|
| UI | Existing React application; TypeScript if already in use |
| API | Existing FastAPI backend |
| Database | Existing database if suitable; PostgreSQL is a good default for relational history |
| Source analysis | TypeScript/JavaScript AST parser, filesystem scanner, bundler metadata |
| Browser automation | Playwright |
| Page audits | Lighthouse |
| Real-user metrics | `web-vitals` and browser Performance APIs |
| React profiling | React Profiler and React DevTools profiling data |
| Background jobs | Durable queue and worker when scans become long-running or concurrent |
| Temporary queue/cache | Optional Redis, introduced when justified by workload |
| Report storage | Database for structured results; file/object storage for larger artifacts |

Do not add all technologies immediately. First inspect what the existing application already uses.

---

## 3. Backend module breakdown

Create separate services or packages with clear interfaces. Follow the existing repository layout instead of forcing a new folder structure.

### A. Project and Scan Manager

Responsibilities:

- Register projects and store repository/target configuration.
- Validate that a project and target are authorized.
- Create scans and record the source revision.
- Track queued, running, completed, failed, and cancelled states.
- Track progress and per-module results.
- Enforce scan timeouts, concurrency, and cancellation.
- Preserve scan configuration for reproducibility.

Suggested outputs: project ID, scan ID, scan status, progress, configuration, commit SHA.

### B. Asset Intelligence Service

Responsibilities:

- Walk the allowed source directory while respecting exclusions.
- Inventory images, videos, SVGs, fonts, icons, CSS, JavaScript, and other static files.
- Parse JavaScript/TypeScript imports and asset references with AST-aware tooling where appropriate.
- Inspect CSS references, HTML, public/static directories, manifests, and bundler output.
- Record source paths, content hashes, file sizes, types, and discovered references.
- Identify duplicate-content candidates.
- Compare source assets with runtime resource observations.
- Identify potentially unused assets and clearly report scan coverage and uncertainty.
- Detect optimization candidates such as oversized images and missing responsive variants.

Important limitations:

- An asset not observed in one browser session is not necessarily unused.
- Dynamic imports, CMS content, runtime-generated URLs, conditional features, lazy-loaded routes, and external assets can hide usage.
- Avoid deleting files automatically.
- Use “potentially unused” until route coverage and reference analysis provide sufficient evidence.

### C. API Intelligence Service

Responsibilities:

- Ingest browser-observed `fetch` and `XMLHttpRequest` timings.
- Normalize dynamic endpoint paths into templates, such as `/api/users/{id}`.
- Group observations by project, route, endpoint, method, status, and environment.
- Calculate count, average, median/p50, p95, p99, error rate, timeout rate, and response-size distributions.
- Detect repeated identical requests and possible duplicate calls.
- Provide API waterfalls and request timelines.
- Correlate requests with routes and user interactions when available.
- Optionally accept backend trace data for server-side timing.

Do not assume browser duration equals backend processing time. Use backend instrumentation or distributed tracing to distinguish server execution from network and browser overhead.

### D. React Render Analyzer

Responsibilities:

- Support an explicit opt-in profiling mode.
- Use React Profiler to collect supported commit and subtree timing information.
- Record route, stable component-tree identity, phase, actual duration, base duration where available, and commit identifier.
- Provide render counts and timing distributions.
- Highlight expensive subtrees and repeated work as investigation candidates.
- Correlate profiling with user interactions when possible.
- Explain the limits of the available evidence.

Important limitations:

- A render count alone does not prove a performance problem.
- Standard React Profiler data does not always identify the exact reason a component rendered.
- Props, state, context, parent updates, and effect behavior may require additional instrumentation or developer inspection.
- Profiling has overhead. Prefer development or profiling-enabled builds and opt-in production use where appropriate.
- Do not promise source-level explanations unless the instrumentation can substantiate them.

Potential recommendations include checking parent renders, unstable object/function props, expensive calculations, unnecessary context updates, and list virtualization. Recommend `React.memo`, `useMemo`, or `useCallback` only when measurement indicates that they are likely to help.

### E. Page Performance Service

Responsibilities:

- Run Playwright scenarios against approved target URLs.
- Discover or accept an explicit list of routes.
- Support configured viewports, navigation flows, authentication setup, and representative interactions.
- Collect Core Web Vitals, navigation/resource timings, long tasks, failed resources, and page-level measurements where supported.
- Run Lighthouse lab audits when useful.
- Record test configuration, browser version, viewport, environment, timestamp, and source revision.
- Keep synthetic lab results separate from real-user observations.
- Correlate LCP resources with asset records where source mapping or build manifests allow it.

Core Web Vitals targets to use as configurable reference defaults:

- LCP: good at or below 2.5 seconds.
- INP: good at or below 200 milliseconds.
- CLS: good at or below 0.1.

For field assessment, evaluate the 75th percentile of page visits. Do not present a single lab run as a field result.

### F. Findings and Recommendation Engine

Responsibilities:

- Run deterministic rules against source findings and measured observations.
- Store supporting evidence and the rule version.
- Separate severity from confidence.
- Mark causes as confirmed, likely, or suspected.
- Provide remediation guidance and a verification procedure.
- Track finding status: open, accepted, ignored, fixed, or recheck required.
- Compare findings across scans and avoid unnecessary duplicates.
- Allow project-specific performance budgets.

Do not generate unsupported diagnoses. A finding must include the measurement or source evidence that triggered it.

---

## 4. Browser instrumentation SDK

Implement a small optional JavaScript/TypeScript SDK for target applications. It should be independently versioned and compatible with the target application's supported React/browser versions.

Example proposed configuration:

```tsx
import { initPerformanceMonitor } from "@your-tool/browser-sdk";

initPerformanceMonitor({
  projectId: "project_123",
  endpoint: "https://your-monitor.example.com",
  sampleRate: 1,
  captureWebVitals: true,
  captureNetwork: true,
});
```

This is an example API contract, not an existing package.

### SDK responsibilities

- Record page navigation and route changes.
- Observe supported browser resource and navigation timing entries.
- Collect Core Web Vitals through `web-vitals`.
- Instrument `fetch` and `XMLHttpRequest` carefully, or use supported instrumentation libraries.
- Normalize and redact URLs before telemetry is sent.
- Buffer and batch events.
- Retry only where appropriate and avoid unbounded queues.
- Support sampling, opt-out, and instrumentation health status.
- Avoid collecting secrets or sensitive payloads.
- Keep React profiling separate and explicitly enabled.

### Runtime modes

| Mode | Primary purpose |
|---|---|
| Static scan | Source references, assets, dependencies |
| Automated browser test | Repeatable route, resource, API, and page measurements |
| Development profiling | React component investigation |
| Production monitoring | Real-user trends and performance distributions |

Do not use one measurement mode as a substitute for another. In particular, source scanning cannot determine actual resource load duration, and a browser session cannot establish that every unobserved source asset is unused.

---

## 5. Initial data model

Adapt these entities to the existing database and naming conventions. Prefer migrations rather than manually changing a live schema.

### `projects`

One record per monitored application.

- `id`
- `name`
- `repository_url` or repository reference
- `target_base_url`
- `framework`
- `created_at`
- `updated_at`

Do not store repository secrets directly in this table. Use an approved secret store or protected credential mechanism.

### `scans`

One record per scan execution.

- `id`
- `project_id`
- `commit_sha`
- `scan_type` — static, runtime, full
- `status` — queued, running, completed, failed, cancelled
- `started_at`
- `completed_at`
- `config_json`
- `error_summary`

### `assets`

Source-level and discovered assets.

- `id`
- `scan_id`
- `source_path`
- `asset_type`
- `size_bytes`
- `content_hash`
- `reference_count`
- `usage_status` — used, potentially_unused, unknown
- `evidence_json`

### `asset_runtime_events`

Runtime resource observations.

- `id`
- `project_id`
- `scan_id` where applicable
- `session_id` where applicable
- `page_path`
- `resource_url_key`
- `initiator_type`
- `duration_ms`
- `transfer_size_bytes`
- `status`
- `observed_at`

### `api_requests`

Individual API request observations.

- `id`
- `project_id`
- `scan_id` where applicable
- `session_id` where applicable
- `page_path`
- `endpoint_template`
- `method`
- `status_code`
- `duration_ms`
- `response_size_bytes`
- `correlation_id`
- `observed_at`

### `component_profiles`

React Profiler observations.

- `id`
- `project_id`
- `scan_id` where applicable
- `session_id` where applicable
- `page_path`
- `component_tree_key`
- `phase`
- `actual_duration_ms`
- `base_duration_ms`
- `commit_id`
- `observed_at`

Use a stable tree identity; a component name alone is insufficient when the same component is rendered in multiple places.

### `page_metrics`

Route and test measurements.

- `id`
- `project_id`
- `scan_id` where applicable
- `session_id` where applicable
- `page_path`
- `metric_name`
- `metric_value`
- `unit`
- `rating`
- `viewport`
- `measurement_mode` — lab or field
- `observed_at`

### `findings`

Actionable findings derived from analysis.

- `id`
- `project_id`
- `scan_id`
- `rule_id`
- `category`
- `severity`
- `confidence`
- `title`
- `description`
- `entity_type`
- `entity_id`
- `evidence_json`
- `recommendation`
- `verification_plan`
- `status`
- `created_at`
- `updated_at`

### Data modeling rules

- Store durations in milliseconds and byte sizes as integers.
- Store timestamps in UTC.
- Preserve raw observations separately from aggregates.
- Calculate p50/p95/p99 from sufficient underlying observations, not by averaging percentiles or averages.
- Store the source commit and test configuration for reproducibility.
- Normalize dynamic endpoint IDs and remove sensitive query parameters.
- Use relative source paths rather than developer-specific absolute paths.
- Index common query dimensions such as `(project_id, observed_at)`, `(scan_id, page_path)`, and `(scan_id, endpoint_template)`.
- Add retention policies and partitioning only when volume warrants them.

---

## 6. FastAPI endpoint proposal

Keep configuration/control APIs separate from high-volume telemetry ingestion.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/projects` | Register a project |
| `GET` | `/api/projects/{project_id}` | Retrieve project configuration |
| `POST` | `/api/projects/{project_id}/scans` | Create and enqueue a scan |
| `GET` | `/api/scans/{scan_id}` | Retrieve scan status and progress |
| `GET` | `/api/scans/{scan_id}/assets` | Retrieve asset inventory |
| `GET` | `/api/scans/{scan_id}/apis` | Retrieve API performance |
| `GET` | `/api/scans/{scan_id}/components` | Retrieve component profiles |
| `GET` | `/api/scans/{scan_id}/pages` | Retrieve page metrics |
| `GET` | `/api/scans/{scan_id}/findings` | Retrieve findings |
| `POST` | `/api/telemetry/batch` | Ingest validated telemetry batches |
| `GET` | `/api/projects/{project_id}/history` | Compare historical scans |

For long scans, the creation endpoint should persist a scan record, enqueue work, and return the scan ID. Use polling or Server-Sent Events for progress.

Do not execute long Playwright tests or full repository scans inside a normal request handler. FastAPI `BackgroundTasks` is suitable for lightweight work; use a durable job queue and separate workers for long-running or concurrent scans that must survive restarts.

### Telemetry validation

Use Pydantic models and enforce:

- Event schema version.
- Authentication and project-level authorization.
- Maximum batch size and request body size.
- Allowed event types and field lengths.
- Timestamp validation.
- Duration and size bounds.
- Rate limits and sampling.
- Redaction of sensitive fields.
- Idempotency or duplicate-event handling where required.

Example simplified payload:

```json
{
  "projectId": "project_123",
  "sessionId": "session_456",
  "events": [
    {
      "type": "api_request",
      "pagePath": "/dashboard",
      "endpoint": "/api/reports",
      "method": "GET",
      "status": 200,
      "durationMs": 1840,
      "timestamp": "2026-10-19T10:30:00Z"
    }
  ]
}
```

In production, use one consistent event envelope with project ID, event ID, schema version, timestamp, and measurement mode. Never collect authorization headers, cookies, passwords, or sensitive request/response bodies.

---

## 7. Initial rule catalog

Begin with deterministic rules. Make thresholds configurable by project and route.

| Rule ID | Trigger | Recommended investigation |
|---|---|---|
| `ASSET-001` | Large image is associated with slow LCP | Check dimensions, compression, responsive variants, loading priority |
| `ASSET-002` | Source asset has no detected reference | Verify dynamic usage, route coverage, public assets, runtime loading |
| `ASSET-003` | Duplicate content hashes | Review duplicate files and whether shared assets are practical |
| `API-001` | Endpoint exceeds its latency budget | Inspect network timing, server traces, dependencies |
| `API-002` | Repeated equivalent requests occur close together | Check effects, query caching, refetch policy, intentional polling |
| `API-003` | Endpoint failure rate exceeds its budget | Inspect status codes, network failures, server logs |
| `REACT-001` | Repeated expensive component commits | Profile parent updates, props, state, context, expensive calculations |
| `PAGE-001` | LCP exceeds the configured target | Inspect LCP resource, loading chain, server response, main-thread work |
| `PAGE-002` | INP is poor | Inspect event handlers, long tasks, rendering after interaction |
| `BUNDLE-001` | Initial JavaScript bundle exceeds budget | Inspect bundle composition, dependencies, code splitting |

Each finding should include:

1. Rule ID and rule version.
2. Affected page, asset, endpoint, or component.
3. Measured evidence and time window.
4. Severity and confidence as separate values.
5. Confirmed facts versus suspected causes.
6. Recommended fix.
7. Verification steps.
8. Status and links to relevant scan details.

Do not claim that an API caused poor LCP merely because the API was slow at the same time. Establish a dependency or timing relationship before making that diagnosis.

---

## 8. React dashboard structure

Implement the dashboard incrementally using existing UI patterns and components.

### Overview

- Recent scan status and history.
- Number of pages and endpoints observed.
- Asset inventory and potentially unused candidates.
- Slow endpoints and error rates.
- Core Web Vitals status.
- High-priority findings.
- Comparison with a previous scan.

### Assets

- Search, filter, sort, and paginate assets.
- Filter by type, size, usage status, and route.
- Display source path, references, content hash, runtime usage, and load timing where available.
- Clearly label potentially unused assets and scan coverage.

### API Performance

- Endpoint summary table.
- Request count, average, p50, p95, p99, error rate, and response size.
- Request waterfall and time-series charts.
- Route and method filters.
- Duplicate-request candidates and failure details.

### Component Profiler

- Component tree or flamegraph.
- Render/commit counts and measured durations.
- Phase and route filters.
- Expensive subtree highlights.
- Supporting profile evidence and recommended investigation.

### Page Performance

- Core Web Vitals.
- Navigation and resource timings.
- Lab versus field data separation.
- Viewport and environment filters.
- Resource and API contributors where evidence supports correlation.

### Recommendations

- Severity and confidence filters.
- Group findings by route, category, or entity.
- Show evidence, suggested fix, and verification steps.
- Allow developers to mark a finding as accepted, ignored, fixed, or needing recheck.

### Scan History

- Compare scans by commit.
- Show metric changes and new/resolved findings.
- Keep test configuration visible to avoid misleading comparisons.

---

## 9. Phased implementation roadmap

Estimates are planning ranges for one developer familiar with the existing codebase. Actual duration depends on existing features and infrastructure.

### Phase 1 — Project scanner and scan infrastructure (1–2 weeks)

- Inspect current project architecture and database.
- Register projects and source revisions.
- Add scan lifecycle, progress, cancellation, and error handling.
- Scan source directories and inventory assets.
- Parse imports/references and compute content hashes.
- Persist results and display an initial asset report.

**Exit criteria:** A scan can run reliably and produce a stored, inspectable static asset inventory.

### Phase 2 — Browser monitoring and API analysis (1–2 weeks)

- Add Playwright scenarios for approved target URLs.
- Collect runtime resource and API measurements.
- Normalize endpoint templates.
- Calculate latency percentiles, counts, and error rates.
- Display API waterfalls and slow-request findings.

**Exit criteria:** The same configured browser test can be rerun and its request results compared.

### Phase 3 — Page performance analyzer (1–2 weeks)

- Capture LCP, INP, and CLS.
- Add Lighthouse lab audits.
- Support desktop/mobile viewports and explicit route lists.
- Correlate LCP resources with asset records where possible.
- Separate lab metrics from field metrics.

**Exit criteria:** Every completed test has route-level metrics, test metadata, and actionable findings.

### Phase 4 — React render analyzer (1–2 weeks)

- Add opt-in profiling mode.
- Record supported React Profiler timings and commit counts.
- Display expensive subtrees and repeated-work candidates.
- Add clear instrumentation limitations and evidence.

**Exit criteria:** Developers can inspect measured component performance without treating every render as wasteful.

### Phase 5 — Findings and recommendations (about 1 week)

- Implement configurable rules and budgets.
- Store severity, confidence, evidence, and verification steps.
- Correlate asset, API, page, and component observations.
- Add finding lifecycle and deduplication.

**Exit criteria:** Every recommendation is traceable to source or runtime evidence.

### Phase 6 — History and production readiness (1–2 weeks)

- Compare scans by commit and configuration.
- Add performance budgets and regression checks.
- Add scheduled scans and retention policies.
- Harden authentication, isolation, resource limits, and telemetry handling.
- Add report export and operational monitoring.

**Exit criteria:** The platform can be used repeatedly across projects with reproducible results and controlled access.

Estimated total: approximately **6–11 weeks** for an initial usable implementation. Reduce scope or adjust the estimate after inspecting the existing codebase.

---

## 10. Security and reliability requirements

Because the tool reads source code and launches browsers against URLs, security must be part of the initial design.

- **Repository isolation:** Restrict access to approved repositories/directories. Do not execute untrusted project scripts by default. Isolate builds and tests.
- **URL protection:** Prevent SSRF. Block loopback, private, link-local, and cloud metadata addresses unless explicitly authorized in a controlled environment. Revalidate redirects and DNS resolution.
- **Credential handling:** Use protected secret storage. Never place repository tokens or cookies in ordinary scan records.
- **Browser isolation:** Use controlled browser contexts and clean up sessions, downloads, and temporary files.
- **Telemetry privacy:** Do not record sensitive headers, cookies, passwords, or request/response bodies. Redact URLs and query parameters.
- **Resource limits:** Set scan timeouts, file-count limits, maximum file sizes, concurrency limits, and upload limits.
- **Access control:** Authorize project, scan, and telemetry operations by tenant/user as appropriate.
- **Retention:** Define retention periods for raw events, profiles, screenshots, traces, and reports.
- **Auditability:** Record who initiated scans and which source revision/configuration was analyzed.
- **Safe remediation:** Recommend code changes first. Require explicit approval before modifying source files or deleting assets.

---

## 11. Acceptance criteria

The first usable release should satisfy the following:

- [ ] A project can be registered and scanned.
- [ ] Scan status, progress, failure details, and cancellation are visible.
- [ ] Source assets have paths, types, sizes, references, and usage confidence.
- [ ] Potentially unused assets are not automatically deleted or presented as certain.
- [ ] API observations are grouped by endpoint template and route.
- [ ] Latency percentiles and error rates are computed from sufficient observations.
- [ ] Lab and field page metrics are stored and presented separately.
- [ ] React profiles show measured timings and clear limitations.
- [ ] Findings contain evidence, severity, confidence, recommendations, and verification steps.
- [ ] Results can be compared by scan and source revision.
- [ ] Sensitive telemetry is excluded or redacted.
- [ ] Repository and browser scanning run within configured security and resource limits.

---

## 12. First vertical slice to implement

Do not implement all modules simultaneously. Begin with one end-to-end workflow:

1. Register a project and its authorized source/target configuration.
2. Create a scan record with a source revision and configuration.
3. Enqueue a static asset scan.
4. Inventory assets and parse source references.
5. Persist the scan results.
6. Generate initial asset findings.
7. Display scan progress and the asset report in React.
8. Add tests for scan lifecycle, parsing, error handling, and usage-status classification.

Once this workflow is reliable, add browser telemetry and API measurements to the same scan/result model. Then implement page metrics, React profiling, correlation, and historical comparisons.

**Final implementation principle:** Build a reliable measurement pipeline first, then add interpretation. A trustworthy tool with clear evidence and reproducible results is more useful than a dashboard full of scores or speculative AI recommendations.
