# Performance Monitor — Implementation Plan

## 1. Objective

Extend the existing React + Python Performance Monitor into a unified performance analysis platform that combines:

1. **Static source analysis** — inventory assets, resolve source references, inspect dependencies and identify potentially unused files.
2. **Browser runtime analysis** — collect resource timings, API request metrics and page performance measurements from a running target application.
3. **React rendering analysis** — collect opt-in React Profiler metrics and identify expensive component subtrees.
4. **Findings and recommendations** — turn measured evidence into actionable, explainable suggestions.
5. **Historical comparison** — compare scans and identify regressions over time.

**Important:** Extend the existing application. First inspect its current architecture, conventions, dependencies, database and UI. Do not replace the stack or rewrite working modules without a clear reason.

## 2. Instructions for Cursor

Before making changes:

- Inspect the repository and summarize the existing frontend, backend, persistence layer, API conventions, tests and run commands.
- Identify the current Python framework instead of assuming FastAPI, Flask or Django.
- Identify whether the project already has job/background-task infrastructure, database models, migrations, authentication and UI components that should be reused.
- Propose a short implementation plan based on the actual repository.
- Implement incrementally, preserving existing behavior and design conventions.
- Do not introduce unnecessary dependencies or duplicate existing functionality.
- Add tests for each feature and update project documentation.
- If a required architectural decision is unclear, document the assumption and choose the smallest reversible implementation.

## 3. Core Architecture

Use the following logical pipeline, adapting it to the current repository:

```text
React Performance Monitor UI
            |
            v
Existing Python API
            |
            v
Scan Orchestrator / Background Jobs
            |
            +------------------------------+
            |                              |
            v                              v
Static Analysis Engine             Browser Analysis Engine
- Asset inventory                  - Playwright browser session
- Source reference parsing         - Network request capture
- Dependency/build metadata        - Resource timing
- Potentially unused assets         - Page metrics / Lighthouse
                                   - Optional React Profiler collector
            |                              |
            +---------------+--------------+
                            v
                 Analysis & Correlation
                 - Aggregations
                 - Findings
                 - Recommendations
                 - Baseline comparisons
                            |
                            v
                 Existing database/storage
                            |
                            v
                 React monitoring dashboard
```

### Architecture requirements

- Static analysis must not execute project code.
- Runtime analysis must run in an isolated browser/process environment with time, CPU and memory limits.
- Long-running scans must not block normal API requests. Reuse existing job infrastructure; add a queue only if necessary.
- Store scan metadata and aggregate results durably.
- Keep raw browser events/traces optional and subject to retention limits.
- Clearly distinguish static findings, synthetic browser measurements and real-user telemetry.
- Do not label an inferred root cause as confirmed without supporting evidence.
- Support cancellation, timeouts, partial failures and readable scan progress.

## 4. Suggested Modules

Adapt names to the existing codebase rather than blindly creating every directory.

### Backend

- **Project Registry** — registered repository path, framework/build detection, routes and scan configuration.
- **Scan Orchestrator** — create scan jobs, report progress, cancel jobs, handle errors and persist final status.
- **Static Analyzer** — enumerate files, parse source references, inspect build output and dependencies.
- **Asset Analyzer** — classify asset types, calculate file sizes/hashes, find duplicate candidates and track references.
- **Browser Analyzer** — launch configured routes, capture network activity and browser timing.
- **API Analyzer** — normalize endpoint templates and calculate latency/error statistics.
- **Page Analyzer** — collect lab metrics and, separately, ingest field metrics when an SDK is installed.
- **React Profiler Collector** — receive opt-in profiling events from instrumented React component trees.
- **Analysis Engine** — aggregate measurements and produce rule-based findings.
- **Recommendation Engine** — attach actionable suggestions, severity, confidence and verification steps.
- **Reporting API** — serve scan status, findings, page metrics, assets, API statistics, component metrics and comparisons.

### Frontend

Add or extend these screens using the existing UI framework and design system:

1. Projects
2. Scan configuration and progress
3. Performance overview
4. Asset Intelligence
5. API Performance
6. Page Performance
7. React Component Profiling
8. Findings and Recommendations
9. Scan comparison/history
10. Scan details and errors

Prefer reusable tables, filters, pagination, charts and loading/error/empty states. Do not add sample metrics to production screens as if they were real results.

## 5. Phase 0 — Repository Discovery

Complete this phase before implementing features.

1. Inspect frontend/backend directory structures and entry points.
2. Identify the Python framework, database, migrations, authentication, background tasks and test frameworks.
3. Identify frontend build tooling (Vite, webpack, etc.), React version, router and package manager.
4. Identify existing monitoring features and avoid duplicating them.
5. Identify the supported target-project frameworks for the first release.
6. Document local development commands and how the target application will be started.
7. Create a concise implementation proposal with files to modify, dependencies needed and migration impact.

**Deliverable:** A repository-specific implementation plan and a list of assumptions.

## 6. Phase 1 — Project Registration and Asset Intelligence

### 6.1 Project registration

Allow a user to register an existing local repository or configured Git checkout.

Store, where appropriate:

- Project ID and name
- Canonical repository path
- Detected framework and build tool
- Optional start/build commands
- Optional base URL and route list
- Default viewport and scan settings
- Created/updated timestamps

Security:

- Restrict paths to explicitly allowed directories.
- Resolve and validate paths to prevent path traversal.
- Do not read or expose `.env`, private keys, credentials or unrelated files.
- Treat repository configuration and build scripts as untrusted.

### 6.2 Asset inventory

Discover common assets including images, SVGs, videos, audio, fonts, CSS and other static resources.

Record:

- File path relative to repository root
- Asset type and extension
- File size in bytes
- Content hash for duplicate detection
- Source references, when found
- Routes where observed at runtime, when available
- Last scan ID and classification

### 6.3 Reference analysis

Use parsers appropriate to the source format where practical. Support imports and references in JavaScript/TypeScript, JSX/TSX, CSS, HTML and common manifests. Support common dynamic asset patterns when feasible.

Do not rely on plain-text search alone. Record unresolved/dynamic references as uncertain.

Classify assets using states such as:

- `referenced_and_observed`
- `referenced_not_observed`
- `observed_without_source_match`
- `potentially_unused`
- `missing_reference`
- `duplicate_candidate`

An asset not seen in one browser run is **not** proof that it is unused. Lazy-loaded routes, conditional features, CMS assets and dynamic URLs may not be observed. Never delete files automatically.

### 6.4 Asset findings

Detect and report:

- Largest assets
- Duplicate candidates
- Assets referenced in source but not observed during tested routes
- Assets observed without a matching source reference
- Missing local references
- Assets that failed to load
- Asset loading duration and transferred bytes where browser APIs expose them
- Possible image optimization and responsive-image opportunities

**Acceptance criteria:**

- User can register a project and start an asset scan.
- Scan progress and failure details are visible.
- Results show file path, type, size, hash where available, references and classification.
- Potentially unused assets include an uncertainty explanation.
- Tests cover dynamic references, ignored directories, missing files and path validation.

## 7. Phase 2 — Browser Runtime and API Performance

### 7.1 Browser runner

Use Playwright if compatible with the existing architecture. Python Playwright or a separate TypeScript/Node.js worker are both acceptable; choose based on repository conventions and maintenance cost.

The runner should:

- Launch an isolated browser context.
- Navigate configured routes.
- Capture request/response events and resource timing.
- Record navigation outcome and console/page errors where useful.
- Support configurable viewport, timeout and limited throttling settings.
- Produce readable per-route results.
- Save detailed traces only when enabled.

Do not let a target project or supplied URL access arbitrary internal services. Apply network restrictions and resource limits.

### 7.2 API observation model

Capture only necessary metadata:

- Scan ID and route
- Normalized endpoint template
- HTTP method
- Status code or failure type
- Request start time
- Duration
- Response/transfer size where available
- Resource type
- Initiator/component correlation when available
- Environment and browser details

Never store authorization headers, cookies, passwords, or sensitive request/response bodies by default.

Normalize dynamic paths such as `/api/users/123` to `/api/users/{id}` when the pattern can be safely inferred or configured. Avoid storing query parameters that may contain secrets or personal information.

### 7.3 API analysis

For endpoints and routes, calculate:

- Request count
- Error and timeout rate
- Median duration
- P95 and P99 duration when sample size supports useful estimates
- Slowest requests
- Duplicate/repeated request candidates
- Concurrent and sequential request patterns where timing supports the conclusion

Use configurable thresholds per endpoint or project. Do not hard-code one latency threshold for every API.

Do not combine p95 values by averaging them. Compute percentiles from the underlying samples or suitable histograms.

**Acceptance criteria:**

- Browser scan works for configured routes.
- API table shows endpoint, method, count, median, p95, error rate and sample count.
- Individual request details and route context are available.
- Failed and timed-out requests are represented correctly.
- Sensitive headers, cookies and bodies are not persisted.
- Tests cover endpoint normalization, percentile calculations, failures and small sample counts.

## 8. Phase 3 — Page Performance and React Profiling

### 8.1 Page metrics

Collect synthetic lab measurements using browser APIs and, where suitable, Lighthouse.

Include:

- Navigation and resource timing
- LCP, INP and CLS when validly measured
- JavaScript/main-thread diagnostics where available
- Total transferred bytes and resource breakdown
- Console/page errors
- Screenshot/trace references when enabled

Keep lab measurements separate from real-user field data. A synthetic test does not represent all real users. Core Web Vitals field targets may be used as reference thresholds, but show sample count and percentile context.

For field monitoring, use an opt-in `web-vitals` integration and report only appropriately sanitized metrics.

### 8.2 React profiling integration

Create an optional, documented integration for target React applications using React's `<Profiler>` API.

Collect:

- Profiled subtree/component ID
- Route and scan/session ID
- Phase (`mount`, `update`, `nested-update`)
- `actualDuration`
- `baseDuration`
- `startTime` and `commitTime`
- Event timestamp and environment

Batch events instead of sending one network request per render. Provide sampling and opt-in controls. Avoid enabling expensive profiling globally in production.

Important limitations:

- Standard React Profiler data describes profiled subtree commits; it does not automatically prove why each component rendered.
- A render is not necessarily unnecessary.
- `actualDuration` and `baseDuration` must be explained accurately; do not describe either as exact user-perceived latency.
- Detailed component-level cause detection may require additional instrumentation or React DevTools profiling data.
- Profiling overhead and production-build requirements must be documented.

### 8.3 Rendering analysis

Identify candidates such as:

- Expensive subtrees repeatedly committed during interactions
- Large render durations
- High cumulative rendering work
- Components re-rendering with apparently unchanged inputs, if this is actually measured
- Large lists where virtualization may be worth evaluating

Recommendations may suggest checking state ownership, context updates, unstable object/function props, `React.memo`, `useMemo`, `useCallback` and list virtualization. These are suggestions to validate, not automatic fixes.

**Acceptance criteria:**

- Page metrics show measurement source and environment.
- React profiling is opt-in and documented.
- Component reports include sample count, render count, phase and duration metrics.
- UI does not label all repeat renders as wasted renders.
- Tests cover event validation, aggregation, sampling and missing/partial metric data.

## 9. Phase 4 — Findings, Recommendations and Scan History

### 9.1 Finding structure

Each finding should contain:

- ID, scan ID and project ID
- Category: asset, API, page, React, bundle or general
- Severity
- Title and description
- Affected route, endpoint, asset or component when known
- Evidence and sample count
- Confidence level
- Source of evidence: static, synthetic runtime or field telemetry
- Rule ID/version
- Suggested verification steps
- Created timestamp

### 9.2 Recommendation engine

Start with deterministic rules, not free-form AI diagnosis.

Examples:

- Large image on an initial route → inspect dimensions, format, priority and responsive variants.
- API p95 over a configured threshold → inspect server processing, database timing and request dependencies.
- Repeated identical API requests → investigate effects, caching and request deduplication.
- Expensive repeated profiled subtree → inspect state/props/context and expensive computations.
- Poor LCP → identify the LCP element and its resource/data dependencies.
- Large initial bundle → inspect code splitting and dependency usage.

Every recommendation should explain the evidence, mark likely causes as suspected unless confirmed, and provide a verification procedure.

AI explanations may be added later. If added, provide sanitized metrics and limited code excerpts; do not expose secrets or unrestricted repository access.

### 9.3 Historical comparison

Store scan metadata including:

- Git commit SHA/branch when available
- Scanner version and configuration
- Browser version, viewport and environment
- Start/end time and status
- Metric source and sample count

Compare scans only when their configurations are sufficiently comparable. Mark environment/configuration differences. Use repeatable runs and configurable thresholds to reduce noisy regression alerts.

**Acceptance criteria:**

- Findings are linked to their evidence and recommendations.
- Scan status, failure and cancellation states are persisted.
- Two scans can be compared with deltas.
- Regression rules are configurable and do not treat noisy one-off measurements as conclusive.
- Reports can be exported using the application's existing conventions.

## 10. Phase 5 — CI/CD and Performance Budgets

Once individual scans are reliable:

- Support repeatable browser audits in CI.
- Compare builds or commits.
- Configure budgets for metrics such as initial bundle size, route LCP, API p95 and error rate.
- Fail a CI check only when configured thresholds and measurement reliability criteria are met.
- Save build identifiers and scan reports.
- Add optional alerts for sustained regressions.

Do not implement CI enforcement before scan reproducibility and baseline comparison are reliable.

## 11. Logical Data Model

Reuse existing database models when suitable. These are logical entities, not a requirement to create one table for every item immediately.

### Project

- `id`
- `name`
- `repository_path`
- `framework`
- `config_json`
- `created_at`
- `updated_at`

### ScanRun

- `id`
- `project_id`
- `commit_sha`
- `mode`
- `status`
- `config_json`
- `scanner_version`
- `started_at`
- `completed_at`
- `error_summary`

### Asset

- `id`
- `project_id`
- `file_path`
- `asset_type`
- `file_size_bytes`
- `content_hash`

### AssetUsage

- `id`
- `scan_id`
- `asset_id`
- `source_file`
- `route`
- `usage_type`
- `confidence`

### PageResult

- `id`
- `scan_id`
- `route`
- `viewport_json`
- `metric_source`
- `lcp_ms`
- `inp_ms`
- `cls`
- `total_transfer_bytes`
- `sample_count`

Allow nullable fields for metrics that could not be measured. Do not use zero to mean “not available.”

### ApiObservation

- `id`
- `scan_id`
- `route`
- `endpoint_template`
- `method`
- `status_code`
- `duration_ms`
- `transfer_bytes`
- `failure_type`
- `observed_at`

For larger workloads, store raw observations with retention limits and build aggregate records for dashboard queries.

### ComponentMetric

- `id`
- `scan_id`
- `route`
- `component_id`
- `phase`
- `actual_duration_ms`
- `base_duration_ms`
- `start_time_ms`
- `commit_time_ms`
- `sample_count`

Choose whether a record represents an individual profiler event or an aggregate. If aggregating, retain clear definitions for count, sum, maximum and percentile fields.

### Finding

- `id`
- `scan_id`
- `category`
- `severity`
- `title`
- `description`
- `evidence_json`
- `confidence`
- `rule_id`
- `created_at`

### Recommendation

- `id`
- `finding_id`
- `description`
- `suggested_fix`
- `verification_steps`
- `status`

Add indexes based on query patterns, especially project/scan IDs, route, endpoint template, category and timestamps. Use migrations compatible with the existing database.

## 12. Suggested API Endpoints

Adapt the prefix and response conventions to the current backend.

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/v1/projects` | Register a project |
| `GET` | `/api/v1/projects` | List projects |
| `POST` | `/api/v1/projects/{id}/scans` | Start a scan |
| `GET` | `/api/v1/scans/{id}` | Get scan status/progress |
| `POST` | `/api/v1/scans/{id}/cancel` | Cancel a running scan |
| `GET` | `/api/v1/scans/{id}/summary` | Get overview |
| `GET` | `/api/v1/scans/{id}/assets` | Get asset inventory |
| `GET` | `/api/v1/scans/{id}/apis` | Get API analysis |
| `GET` | `/api/v1/scans/{id}/pages` | Get page results |
| `GET` | `/api/v1/scans/{id}/components` | Get React profiling data |
| `GET` | `/api/v1/scans/{id}/findings` | Get findings/recommendations |
| `GET` | `/api/v1/projects/{id}/compare?baseline={scanId}&current={scanId}` | Compare two scans |

Use pagination for large result sets and validate all IDs, filters, sorting parameters and request payloads. Add authentication and authorization consistent with the existing application.

## 13. Frontend UI Requirements

Build on the existing design system. Do not redesign unrelated screens.

### Overview

Show:

- Latest scan status and timestamp
- Page metric summary
- API latency and error summary
- Asset inventory summary
- React profiling summary, when collected
- Highest-priority findings
- Comparison with the selected baseline

### Asset Intelligence

Include search, filtering by type/status, sorting by size, file path, reference count and observed loading time. Provide an asset detail view with source references and routes where it was observed.

### API Performance

Include endpoint grouping, request counts, median/p95/p99 when statistically useful, error rate, status breakdown and request waterfall/details.

### Page Performance

Include route-level metrics, resource breakdown, measurement environment, metric source and links to relevant findings.

### React Profiling

Include component/subtree metrics, commit counts, phases, durations and a drill-down to the profiled route. Make profiling availability and limitations visible.

### Findings

Include severity, confidence, category, affected location, evidence, recommended action and verification instructions.

### Scan UX

Provide loading, empty, partial, failed, cancelled and completed states. Long scans should show progress and permit navigation away without losing job status.

## 14. Non-Functional Requirements

- **Security:** path validation, restricted filesystem access, isolated browser execution and network egress controls.
- **Privacy:** sanitize telemetry; never store secrets, cookies or authorization headers by default.
- **Reliability:** timeouts, cancellation, retries only where safe, idempotent job handling and clear error messages.
- **Performance:** paginate results, aggregate event data and avoid loading all raw observations into the dashboard.
- **Observability:** log scan/job IDs, durations and failure reasons without sensitive payloads.
- **Testing:** unit tests for parsing/rules/metrics, integration tests for APIs and database, and end-to-end tests for a small sample React application.
- **Documentation:** setup, supported project patterns, scan limitations, security model and troubleshooting.

## 15. Recommended Implementation Order

1. **Repository discovery and design confirmation.**
2. **Scan lifecycle, project registration and migrations.**
3. **Static asset inventory and reference classification.**
4. **Playwright runner and network/API collection.**
5. **Page performance and Lighthouse integration.**
6. **Opt-in React Profiler collector.**
7. **Findings, deterministic recommendations and scan comparison.**
8. **CI/CD integration and budgets.**

The first usable milestone should complete steps 2–4 with working UI and tests. Keep the other phases behind clear interfaces so they can be implemented incrementally.

## 16. Definition of Done

The implementation is ready when:

- A user can register a permitted local React repository and start a scan.
- Static analysis reports assets, references, sizes and potential unused candidates.
- A browser scan visits configured routes and captures network/API measurements.
- API summaries include sample counts and meaningful latency/error statistics.
- Page metrics identify whether data came from a lab run or field telemetry.
- Optional React profiling reports actual collected profiler metrics without falsely claiming every render is wasteful.
- Findings link to evidence and provide actionable recommendations.
- Scan status, errors and history are persisted.
- Two compatible scans can be compared.
- Security restrictions and tests are in place.
- Existing application functionality remains intact.

## 17. Final Instructions to Cursor

Implement in small, reviewable steps. Begin with repository discovery and report the current architecture before editing files. Then implement the first milestone, run the existing and new tests, fix regressions, and summarize:

1. Files added/modified
2. Dependencies added and why
3. Database migrations
4. API/UI changes
5. Tests run and results
6. Known limitations
7. Exact commands to run the application and execute a scan

Do not fabricate scan metrics, mark assets as definitely unused without adequate evidence, automatically modify/delete the target project's files, or expose target application secrets in logs or reports.
