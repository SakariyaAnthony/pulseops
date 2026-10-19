import { hashString, mulberry32 } from "@/lib/api/prng";
import { currentKey, mergeIncidents, mergeRules } from "@/lib/api/overrides";
import type {
  Deploy,
  EndpointDetail,
  EndpointRow,
  EnvName,
  ErrorDetail,
  ErrorGroup,
  GraphEdge,
  GraphNode,
  Health,
  HistogramBucket,
  HostSnapshot,
  Incident,
  InsightPreview,
  Kpi,
  Overview,
  Point,
  Project,
  ResourceBundle,
  ResourcesPayload,
  Series,
  ServiceDetail,
  ServiceSummary,
  SettingsPayload,
  SlowTrace,
  StatusSlice,
  TimeRange,
  TimeSpent,
  Timeseries,
} from "@/lib/api/types";

type KpiSeed = {
  avg: number;
  avgDelta: number;
  p95: number;
  p95Delta: number;
  rpm: number;
  rpmDelta: number;
  error: number;
  errorDelta: number;
  apdex: number;
  apdexDelta: number;
};

type ServiceSeed = {
  name: string;
  description: string;
  health: Health;
  latencyMs: number;
  rpm: number;
  errorRate: number;
  instances: number;
  version: string;
  language: string;
  boost: number;
};

type EndpointSeed = {
  method: string;
  route: string;
  service: string;
  calls: number;
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  apdex: number;
  spent: [number, number, number, number];
};

type ErrorSeed = {
  fingerprint: string;
  type: string;
  message: string;
  count: number;
  users: number;
  service: string;
  route: string;
  stack: string;
  ageHours: number;
};

type IncidentSeed = Omit<Incident, "startedAt"> & { ageMin: number };

const RANGE_SPEC: Record<TimeRange, { ms: number; step: number; resolution: string }> = {
  "15m": { ms: 15 * 60_000, step: 60_000, resolution: "1m" },
  "1h": { ms: 60 * 60_000, step: 60_000, resolution: "1m" },
  "6h": { ms: 6 * 60 * 60_000, step: 5 * 60_000, resolution: "5m" },
  "24h": { ms: 24 * 60 * 60_000, step: 15 * 60_000, resolution: "15m" },
  "7d": { ms: 7 * 24 * 60 * 60_000, step: 60 * 60_000, resolution: "1h" },
};

const SHOP_KPI: Record<TimeRange, KpiSeed> = {
  "15m": { avg: 196, avgDelta: 6.2, p95: 710, p95Delta: 11.4, rpm: 13100, rpmDelta: 3.1, error: 0.61, errorDelta: 18, apdex: 0.93, apdexDelta: -1.4 },
  "1h": { avg: 182, avgDelta: -8.4, p95: 640, p95Delta: 4.2, rpm: 12400, rpmDelta: 6.1, error: 0.42, errorDelta: -12.5, apdex: 0.96, apdexDelta: 0.8 },
  "6h": { avg: 174, avgDelta: -3.1, p95: 590, p95Delta: 2.4, rpm: 11840, rpmDelta: 1.8, error: 0.38, errorDelta: -4, apdex: 0.96, apdexDelta: 0.3 },
  "24h": { avg: 168, avgDelta: -1.2, p95: 560, p95Delta: 6.8, rpm: 10920, rpmDelta: 4.4, error: 0.33, errorDelta: 2.1, apdex: 0.97, apdexDelta: 0.2 },
  "7d": { avg: 161, avgDelta: -0.6, p95: 510, p95Delta: 1.1, rpm: 10240, rpmDelta: 2.2, error: 0.29, errorDelta: -1.4, apdex: 0.97, apdexDelta: 0.1 },
};

const SHOP_SERVICES: ServiceSeed[] = [
  { name: "api-gateway", description: "Edge routing, auth, and request limits", health: "healthy", latencyMs: 48, rpm: 12400, errorRate: 0.12, instances: 6, version: "v2.14.1", language: "Node", boost: 1 },
  { name: "orders", description: "Cart, checkout orchestration, order history", health: "degraded", latencyMs: 210, rpm: 3100, errorRate: 0.84, instances: 4, version: "v2.14.1", language: "Node", boost: 1.22 },
  { name: "catalog", description: "Product search and detail reads", health: "healthy", latencyMs: 64, rpm: 5200, errorRate: 0.05, instances: 3, version: "v2.14.0", language: "Python", boost: 1 },
  { name: "payments", description: "Capture, refund, and provider calls", health: "critical", latencyMs: 890, rpm: 840, errorRate: 2.4, instances: 3, version: "v2.14.1", language: "Node", boost: 1.48 },
  { name: "inventory", description: "Stock reservations and SKU lookups", health: "healthy", latencyMs: 95, rpm: 2200, errorRate: 0.18, instances: 2, version: "v2.13.9", language: "Python", boost: 1.04 },
  { name: "notifications", description: "Receipts and webhook fan-out", health: "degraded", latencyMs: 140, rpm: 600, errorRate: 0.4, instances: 2, version: "v2.14.1", language: "Node", boost: 1.08 },
];

const SHOP_ENDPOINTS: EndpointSeed[] = [
  { method: "GET", route: "/api/orders", service: "orders", calls: 980, avgMs: 120, p95Ms: 340, p99Ms: 610, errorRate: 0.2, apdex: 0.97, spent: [70, 40, 8, 2] },
  { method: "GET", route: "/api/orders/:id", service: "orders", calls: 1420, avgMs: 240, p95Ms: 920, p99Ms: 1400, errorRate: 1.1, apdex: 0.88, spent: [80, 620, 30, 40] },
  { method: "POST", route: "/api/checkout", service: "payments", calls: 310, avgMs: 680, p95Ms: 1820, p99Ms: 2400, errorRate: 2.8, apdex: 0.71, spent: [180, 240, 40, 1220] },
  { method: "POST", route: "/api/payments/capture", service: "payments", calls: 290, avgMs: 540, p95Ms: 1610, p99Ms: 2200, errorRate: 2.1, apdex: 0.76, spent: [90, 60, 20, 1380] },
  { method: "GET", route: "/api/products", service: "catalog", calls: 2600, avgMs: 42, p95Ms: 110, p99Ms: 180, errorRate: 0.04, apdex: 0.99, spent: [18, 12, 10, 2] },
  { method: "GET", route: "/api/products/:id", service: "catalog", calls: 1800, avgMs: 38, p95Ms: 96, p99Ms: 150, errorRate: 0.03, apdex: 0.99, spent: [14, 10, 12, 2] },
  { method: "GET", route: "/api/products/search", service: "catalog", calls: 740, avgMs: 88, p95Ms: 260, p99Ms: 410, errorRate: 0.09, apdex: 0.96, spent: [30, 40, 16, 2] },
  { method: "GET", route: "/api/cart", service: "orders", calls: 860, avgMs: 75, p95Ms: 190, p99Ms: 280, errorRate: 0.11, apdex: 0.98, spent: [28, 22, 20, 5] },
  { method: "GET", route: "/api/inventory/:sku", service: "inventory", calls: 1100, avgMs: 70, p95Ms: 180, p99Ms: 260, errorRate: 0.15, apdex: 0.97, spent: [20, 30, 18, 2] },
  { method: "POST", route: "/api/inventory/reserve", service: "inventory", calls: 300, avgMs: 95, p95Ms: 240, p99Ms: 380, errorRate: 0.22, apdex: 0.95, spent: [30, 48, 12, 5] },
  { method: "POST", route: "/api/notifications/receipt", service: "notifications", calls: 280, avgMs: 130, p95Ms: 420, p99Ms: 700, errorRate: 0.4, apdex: 0.93, spent: [40, 10, 8, 72] },
  { method: "GET", route: "/healthz", service: "api-gateway", calls: 240, avgMs: 6, p95Ms: 18, p99Ms: 30, errorRate: 0, apdex: 1, spent: [6, 0, 0, 0] },
];

const BILLING_SERVICES: ServiceSeed[] = [
  { name: "invoices", description: "Invoice issue and PDF render", health: "healthy", latencyMs: 110, rpm: 640, errorRate: 0.06, instances: 2, version: "v1.8.0", language: "Python", boost: 1 },
  { name: "ledger", description: "Double-entry postings", health: "healthy", latencyMs: 72, rpm: 880, errorRate: 0.04, instances: 3, version: "v1.8.0", language: "Node", boost: 1 },
  { name: "tax", description: "Jurisdiction and rate lookup", health: "healthy", latencyMs: 54, rpm: 420, errorRate: 0.02, instances: 2, version: "v1.7.6", language: "Python", boost: 1 },
  { name: "webhooks", description: "Billing event delivery", health: "healthy", latencyMs: 96, rpm: 210, errorRate: 0.11, instances: 2, version: "v1.8.0", language: "Node", boost: 1.05 },
];

const BILLING_ENDPOINTS: EndpointSeed[] = [
  { method: "POST", route: "/v1/invoices", service: "invoices", calls: 180, avgMs: 140, p95Ms: 320, p99Ms: 480, errorRate: 0.08, apdex: 0.97, spent: [60, 40, 10, 30] },
  { method: "GET", route: "/v1/invoices/:id", service: "invoices", calls: 460, avgMs: 48, p95Ms: 120, p99Ms: 180, errorRate: 0.03, apdex: 0.99, spent: [16, 20, 8, 4] },
  { method: "POST", route: "/v1/charges", service: "ledger", calls: 220, avgMs: 90, p95Ms: 210, p99Ms: 340, errorRate: 0.07, apdex: 0.98, spent: [30, 40, 6, 14] },
  { method: "GET", route: "/v1/subscriptions", service: "ledger", calls: 510, avgMs: 36, p95Ms: 88, p99Ms: 140, errorRate: 0.02, apdex: 0.99, spent: [12, 16, 6, 2] },
  { method: "POST", route: "/v1/tax/quote", service: "tax", calls: 390, avgMs: 44, p95Ms: 110, p99Ms: 160, errorRate: 0.02, apdex: 0.99, spent: [18, 8, 14, 4] },
  { method: "POST", route: "/v1/webhooks/deliver", service: "webhooks", calls: 150, avgMs: 120, p95Ms: 280, p99Ms: 460, errorRate: 0.18, apdex: 0.96, spent: [20, 8, 6, 86] },
];

const SHOP_ERRORS: ErrorSeed[] = [
  {
    fingerprint: "a1c9e0",
    type: "TimeoutError",
    message: "upstream timeout talking to payments.example.com",
    count: 1284,
    users: 402,
    service: "payments",
    route: "POST /api/checkout",
    ageHours: 2.2,
    stack: `TimeoutError: upstream timeout talking to payments.example.com
    at captureCharge (payments/src/capture.ts:88:11)
    at processTicksAndRejections (node:internal/process/task_queues:95:5)
    at CheckoutService.place (orders/src/checkout.ts:142:5)
    at Router.handle (api-gateway/src/router.ts:54:9)`,
  },
  {
    fingerprint: "b77d12",
    type: "PrismaClientKnownRequestError",
    message: "order_items query exceeded 47 round-trips on GET /api/orders/:id",
    count: 642,
    users: 188,
    service: "orders",
    route: "GET /api/orders/:id",
    ageHours: 3.4,
    stack: `PrismaClientKnownRequestError: Timed out fetching order_items
    at OrderRepository.load (orders/src/repo.ts:203:13)
    at GetOrder.handle (orders/src/get-order.ts:41:18)
    at Layer.handle (orders/src/http.ts:77:9)`,
  },
  {
    fingerprint: "c30aa4",
    type: "ZodError",
    message: "invalid currency on checkout payload",
    count: 88,
    users: 71,
    service: "orders",
    route: "POST /api/checkout",
    ageHours: 9,
    stack: `ZodError: expected currency to be one of USD, EUR, GBP
    at CheckoutSchema.parse (orders/src/schema.ts:28:19)
    at checkoutHandler (orders/src/routes.ts:61:22)`,
  },
  {
    fingerprint: "d91f55",
    type: "RedisConnectionError",
    message: "connection reset while reading cart session",
    count: 41,
    users: 36,
    service: "orders",
    route: "GET /api/cart",
    ageHours: 14,
    stack: `RedisConnectionError: read ECONNRESET
    at CartCache.get (orders/src/cache.ts:19:11)
    at getCart (orders/src/cart.ts:33:20)`,
  },
];

const BILLING_ERRORS: ErrorSeed[] = [
  {
    fingerprint: "e12b90",
    type: "WebhookTimeout",
    message: "subscriber did not ack within 8s",
    count: 22,
    users: 9,
    service: "webhooks",
    route: "POST /v1/webhooks/deliver",
    ageHours: 8,
    stack: `WebhookTimeout: subscriber did not ack within 8s
    at deliver (webhooks/src/deliver.ts:44:9)`,
  },
];

function shopIncidents(): IncidentSeed[] {
  return [
    {
      id: "inc_1042",
      title: "Payments p95 is 1.6s",
      detail: "p95 latency on payments stayed above 800 ms for 12 minutes after v2.14.1.",
      severity: "critical",
      status: "firing",
      service: "payments",
      project: "shop-api",
      env: "prod",
      ageMin: 18,
    },
    {
      id: "inc_1043",
      title: "Orders error rate is 1.8%",
      detail: "5xx responses on GET /api/orders/:id crossed 1% and are still climbing.",
      severity: "warning",
      status: "firing",
      service: "orders",
      project: "shop-api",
      env: "prod",
      ageMin: 11,
    },
    {
      id: "inc_1038",
      title: "Gateway CPU cooled off",
      detail: "iad1 gateway hosts dropped back under 70% after the autoscaler added a node.",
      severity: "info",
      status: "resolved",
      service: "api-gateway",
      project: "shop-api",
      env: "prod",
      ageMin: 360,
    },
    {
      id: "inc_2041",
      title: "Notification retries queued",
      detail: "Receipt fan-out retried for 9 minutes. Acknowledged by the on-call.",
      severity: "warning",
      status: "acknowledged",
      service: "notifications",
      project: "shop-api",
      env: "staging",
      ageMin: 40,
    },
  ];
}

function billingIncidents(): IncidentSeed[] {
  return [
    {
      id: "inc_3011",
      title: "Webhook lag cleared",
      detail: "Delivery p95 returned under 300 ms after the subscriber patched their ack path.",
      severity: "info",
      status: "resolved",
      service: "webhooks",
      project: "billing-api",
      env: "prod",
      ageMin: 1400,
    },
  ];
}

export const PROJECTS: Project[] = [
  { id: "prj_shop", name: "shop-api", slug: "shop-api" },
  { id: "prj_billing", name: "billing-api", slug: "billing-api" },
];

export function projectBySlug(slug: string): Project {
  return PROJECTS.find((project) => project.slug === slug) ?? PROJECTS[0];
}

export function endpointKey(method: string, route: string): string {
  return `${method} ${route}`;
}

function windowFor(range: TimeRange, now = Date.now()) {
  const spec = RANGE_SPEC[range];
  const end = Math.floor(now / spec.step) * spec.step;
  const start = end - spec.ms;
  return { start, end, step: spec.step, resolution: spec.resolution };
}

function deployMoments(project: string, end: number) {
  if (project === "billing-api") {
    return [{ time: end - 5 * 3_600_000, version: "v1.8.0", note: "Tax rounding now matches the ledger penny." }];
  }
  return [
    { time: end - 2 * 3_600_000, version: "v2.14.1", note: "Checkout waits on the payments provider retry budget." },
    { time: end - 26 * 3_600_000, version: "v2.13.4", note: "Catalog search cache warmed at the edge." },
  ];
}

function markers(project: string, start: number, end: number): Deploy[] {
  return deployMoments(project, end)
    .filter((deploy) => deploy.time >= start && deploy.time <= end)
    .map(({ time, version }) => ({ time, version }));
}

function buildPoints(seed: string, range: TimeRange, base: number, volatility: number, boost: number, project: string): Point[] {
  const { start, end, step } = windowFor(range);
  const rand = mulberry32(hashString(`${seed}:${range}:${project}`));
  const deployAt = project === "billing-api" ? end - 5 * 3_600_000 : end - 2 * 3_600_000;
  const points: Point[] = [];
  let index = 0;
  const lastIndex = Math.round((end - start) / step);
  for (let time = start; time <= end + 1; time += step) {
    const noise = (rand() - 0.5) * 2 * volatility;
    const wave = Math.sin(index / 6.5) * volatility * 0.4;
    let value = base + noise + wave;
    if (boost !== 1 && time >= deployAt) value *= boost;
    if (index === lastIndex) value *= 1 + Math.sin(Date.now() / 4200 + base) * 0.012;
    points.push([time, Math.max(0, Math.round(value * 10) / 10)]);
    index += 1;
    if (index > lastIndex + 2) break;
  }
  return points;
}

function spark(points: Point[], count = 24): number[] {
  if (points.length <= count) return points.map((point) => point[1]);
  const step = (points.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => points[Math.round(index * step)][1]);
}

function timeseries(metric: string, range: TimeRange, series: Series[], project: string): Timeseries {
  const { start, end, resolution } = windowFor(range);
  return { metric, resolution, series, deploys: markers(project, start, end) };
}

function envScale(env: EnvName) {
  if (env === "staging") return { rpm: 0.28, latency: 0.84, error: 0.55, cpu: 0.72 };
  return { rpm: 1, latency: 1, error: 1, cpu: 1 };
}

function stageHealth(health: Health, env: EnvName): Health {
  if (env !== "staging") return health;
  if (health === "critical") return "degraded";
  if (health === "degraded") return "healthy";
  return health;
}

function servicesFor(project: string): ServiceSeed[] {
  return project === "billing-api" ? BILLING_SERVICES : SHOP_SERVICES;
}

function endpointsFor(project: string): EndpointSeed[] {
  return project === "billing-api" ? BILLING_ENDPOINTS : SHOP_ENDPOINTS;
}

function round(value: number, digits = 0) {
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function toEndpoint(seed: EndpointSeed, env: EnvName, range: TimeRange, project: string): EndpointRow {
  const scale = envScale(env);
  const service = servicesFor(project).find((item) => item.name === seed.service);
  const boost = service?.boost ?? 1;
  const trend = spark(
    buildPoints(`${seed.method}${seed.route}`, range, seed.p95Ms * scale.latency, seed.p95Ms * 0.08, boost, project),
    18,
  );
  return {
    key: endpointKey(seed.method, seed.route),
    method: seed.method,
    route: seed.route,
    service: seed.service,
    calls: Math.round(seed.calls * scale.rpm),
    avgMs: round(seed.avgMs * scale.latency),
    p95Ms: round(seed.p95Ms * scale.latency * (env === "prod" ? 1 : 0.92)),
    p99Ms: round(seed.p99Ms * scale.latency),
    errorRate: round(seed.errorRate * scale.error, 2),
    apdex: Math.min(1, round(seed.apdex + (env === "prod" ? 0 : 0.02), 2)),
    trend,
  };
}

function toService(seed: ServiceSeed, env: EnvName, range: TimeRange, project: string): ServiceSummary {
  const scale = envScale(env);
  const points = buildPoints(seed.name, range, seed.latencyMs * scale.latency, seed.latencyMs * 0.08, seed.boost, project);
  return {
    name: seed.name,
    description: seed.description,
    health: stageHealth(seed.health, env),
    latencyMs: round(seed.latencyMs * scale.latency),
    rpm: Math.round(seed.rpm * scale.rpm),
    errorRate: round(seed.errorRate * scale.error, 2),
    instances: seed.instances,
    version: seed.version,
    language: seed.language,
    spark: spark(points, 20),
  };
}

function kpiSet(project: string, env: EnvName, range: TimeRange): KpiSeed {
  if (project === "billing-api") {
    const bump = { "15m": 1.06, "1h": 1, "6h": 0.97, "24h": 0.94, "7d": 0.9 }[range];
    return {
      avg: Math.round(96 * bump),
      avgDelta: -1.6,
      p95: Math.round(220 * bump),
      p95Delta: -0.8,
      rpm: Math.round(1860 / bump),
      rpmDelta: 1.4,
      error: 0.08,
      errorDelta: -3.2,
      apdex: 0.99,
      apdexDelta: 0.2,
    };
  }
  const base = SHOP_KPI[range];
  if (env !== "staging") return base;
  return {
    avg: Math.round(base.avg * 0.84),
    avgDelta: round(base.avgDelta * 0.4, 1),
    p95: Math.round(base.p95 * 0.78),
    p95Delta: round(base.p95Delta * 0.35, 1),
    rpm: Math.round(base.rpm * 0.28),
    rpmDelta: round(base.rpmDelta * 0.5, 1),
    error: round(base.error * 0.55, 2),
    errorDelta: round(base.errorDelta * 0.4, 1),
    apdex: Math.min(0.99, round(base.apdex + 0.02, 2)),
    apdexDelta: round(base.apdexDelta * 0.5, 1),
  };
}

function kpisFrom(seed: KpiSeed, range: TimeRange, project: string, scaleLatency: number): Kpi[] {
  const avgSpark = spark(buildPoints("kpi-avg", range, seed.avg, seed.avg * 0.06, scaleLatency, project));
  const p95Spark = spark(buildPoints("kpi-p95", range, seed.p95, seed.p95 * 0.07, scaleLatency, project));
  const rpmSpark = spark(buildPoints("kpi-rpm", range, seed.rpm, seed.rpm * 0.04, 1, project));
  const errSpark = spark(buildPoints("kpi-err", range, seed.error, Math.max(0.04, seed.error * 0.25), 1, project));
  return [
    { id: "avg", label: "Avg response", value: seed.avg, delta: seed.avgDelta, intent: "lower", unit: "ms", spark: avgSpark },
    { id: "p95", label: "p95", value: seed.p95, delta: seed.p95Delta, intent: "lower", unit: "ms", spark: p95Spark },
    { id: "rpm", label: "Req / min", value: seed.rpm, delta: seed.rpmDelta, intent: "higher", unit: "rpm", spark: rpmSpark },
    { id: "error", label: "Error rate", value: seed.error, delta: seed.errorDelta, intent: "lower", unit: "pct", spark: errSpark },
    { id: "apdex", label: "Apdex", value: seed.apdex, delta: seed.apdexDelta, intent: "higher", unit: "apdex", spark: p95Spark },
  ];
}

function insightsFor(project: string): InsightPreview[] {
  if (project === "billing-api") {
    return [
      {
        id: "pdf",
        severity: "info",
        title: "Invoice PDFs are fine",
        body: "POST /v1/invoices p95 is 320 ms. Nothing is breaching the billing SLO.",
        href: `/endpoints/${encodeURIComponent(endpointKey("POST", "/v1/invoices"))}`,
      },
    ];
  }
  return [
    {
      id: "n-plus-one",
      severity: "critical",
      title: "N+1 on order detail",
      body: "GET /api/orders/:id runs 47 identical order_items queries and adds about 420 ms.",
      href: `/endpoints/${encodeURIComponent(endpointKey("GET", "/api/orders/:id"))}`,
    },
    {
      id: "memory",
      severity: "warning",
      title: "Memory climbing on notifications",
      body: "notifications-2 heap is up 3.2% per hour across the last 6 hours.",
      href: "/services/notifications",
    },
    {
      id: "provider",
      severity: "warning",
      title: "payments.example.com dominates checkout",
      body: "Provider p95 is 1.8 s and accounts for 38% of POST /api/checkout.",
      href: `/endpoints/${encodeURIComponent(endpointKey("POST", "/api/checkout"))}`,
    },
  ];
}

function incidentList(project: string, env: EnvName): Incident[] {
  const now = Date.now();
  const seeds = project === "billing-api" ? billingIncidents() : shopIncidents();
  return seeds
    .filter((incident) => incident.env === env)
    .map((incident) => ({ ...incident, startedAt: now - incident.ageMin * 60_000 }));
}

function rulesFor(project: string) {
  if (project === "billing-api") {
    return [
      { id: "rule_bill_p95", project, name: "Invoice p95", metric: "p95 latency", operator: "above" as const, threshold: 400, window: "5m", severity: "warning" as const, channels: ["slack"], enabled: true },
      { id: "rule_bill_err", project, name: "Billing error rate", metric: "error rate", operator: "above" as const, threshold: 1, window: "10m", severity: "warning" as const, channels: ["email"], enabled: true },
    ];
  }
  return [
    { id: "rule_p95", project, name: "Payments latency", metric: "p95 latency", operator: "above" as const, threshold: 800, window: "5m", severity: "critical" as const, channels: ["slack", "email"], enabled: true },
    { id: "rule_err", project, name: "Error rate", metric: "error rate", operator: "above" as const, threshold: 1, window: "5m", severity: "warning" as const, channels: ["slack"], enabled: true },
    { id: "rule_cpu", project, name: "CPU saturation", metric: "CPU", operator: "above" as const, threshold: 85, window: "10m", severity: "critical" as const, channels: ["webhook"], enabled: true },
    { id: "rule_apdex", project, name: "Apdex floor", metric: "apdex", operator: "below" as const, threshold: 0.9, window: "15m", severity: "warning" as const, channels: ["email"], enabled: false },
  ];
}

function emptySeries(metric: string, range: TimeRange): Timeseries {
  return { metric, resolution: RANGE_SPEC[range].resolution, series: [], deploys: [] };
}

export function mockOverview(project: string, env: EnvName, range: TimeRange): Overview {
  if (env === "dev") {
    return {
      empty: true,
      kpis: [],
      responseTime: emptySeries("response_time", range),
      throughput: emptySeries("throughput", range),
      cpuMemory: emptySeries("resources", range),
      slowEndpoints: [],
      services: [],
      incidents: [],
      insights: [],
    };
  }
  const scale = envScale(env);
  const boost = project === "shop-api" && env === "prod" ? 1.18 : 1;
  const seed = kpiSet(project, env, range);
  const services = servicesFor(project).map((item) => toService(item, env, range, project));
  const endpoints = endpointsFor(project)
    .map((item) => toEndpoint(item, env, range, project))
    .sort((a, b) => b.p95Ms - a.p95Ms);
  return {
    empty: false,
    kpis: kpisFrom(seed, range, project, boost),
    responseTime: timeseries(
      "response_time",
      range,
      [
        { name: "p50", points: buildPoints("p50", range, seed.avg * 0.72, seed.avg * 0.05, boost, project) },
        { name: "p95", points: buildPoints("p95", range, seed.p95, seed.p95 * 0.06, boost, project) },
        { name: "p99", points: buildPoints("p99", range, seed.p95 * 1.45, seed.p95 * 0.08, boost, project) },
      ],
      project,
    ),
    throughput: timeseries(
      "throughput",
      range,
      [{ name: "requests", points: buildPoints("rps", range, seed.rpm, seed.rpm * 0.05, 1, project) }],
      project,
    ),
    cpuMemory: timeseries(
      "resources",
      range,
      [
        { name: "cpu", points: buildPoints("cpu", range, 46 * scale.cpu, 6, project === "shop-api" ? 1.12 : 1, project) },
        { name: "memory", points: buildPoints("mem", range, 62 * scale.cpu, 3, 1.04, project) },
      ],
      project,
    ),
    slowEndpoints: endpoints.slice(0, 5),
    services,
    incidents: mergeIncidents(incidentList(project, env)).slice(0, 4),
    insights: insightsFor(project),
  };
}

export function mockServices(project: string, env: EnvName, range: TimeRange): ServiceSummary[] {
  if (env === "dev") return [];
  return servicesFor(project).map((item) => toService(item, env, range, project));
}

function graphFor(project: string, env: EnvName): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const healthOf = (name: string): Health => {
    const service = servicesFor(project).find((item) => item.name === name);
    return service ? stageHealth(service.health, env) : "healthy";
  };
  if (project === "billing-api") {
    const nodes: GraphNode[] = [
      { id: "client", label: "clients", kind: "client", health: "healthy" },
      { id: "invoices", label: "invoices", kind: "gateway", health: healthOf("invoices") },
      { id: "ledger", label: "ledger", kind: "service", health: healthOf("ledger") },
      { id: "tax", label: "tax", kind: "service", health: healthOf("tax") },
      { id: "webhooks", label: "webhooks", kind: "service", health: healthOf("webhooks") },
      { id: "postgres", label: "postgres", kind: "data", health: "healthy" },
    ];
    const edges: GraphEdge[] = [
      { from: "client", to: "invoices", rps: 18, health: "healthy" },
      { from: "invoices", to: "ledger", rps: 12, health: "healthy" },
      { from: "invoices", to: "tax", rps: 8, health: "healthy" },
      { from: "ledger", to: "postgres", rps: 22, health: "healthy" },
      { from: "ledger", to: "webhooks", rps: 4, health: healthOf("webhooks") },
    ];
    return { nodes, edges };
  }
  const nodes: GraphNode[] = [
    { id: "client", label: "clients", kind: "client", health: "healthy" },
    { id: "api-gateway", label: "api-gateway", kind: "gateway", health: healthOf("api-gateway") },
    { id: "orders", label: "orders", kind: "service", health: healthOf("orders") },
    { id: "catalog", label: "catalog", kind: "service", health: healthOf("catalog") },
    { id: "payments", label: "payments", kind: "service", health: healthOf("payments") },
    { id: "inventory", label: "inventory", kind: "service", health: healthOf("inventory") },
    { id: "postgres", label: "postgres", kind: "data", health: healthOf("orders") },
    { id: "redis", label: "redis", kind: "data", health: "healthy" },
    { id: "provider", label: "payments.example.com", kind: "data", health: healthOf("payments") },
  ];
  const edges: GraphEdge[] = [
    { from: "client", to: "api-gateway", rps: 206, health: "healthy" },
    { from: "api-gateway", to: "orders", rps: 52, health: healthOf("orders") },
    { from: "api-gateway", to: "catalog", rps: 86, health: "healthy" },
    { from: "api-gateway", to: "payments", rps: 14, health: healthOf("payments") },
    { from: "api-gateway", to: "inventory", rps: 28, health: "healthy" },
    { from: "orders", to: "postgres", rps: 40, health: healthOf("orders") },
    { from: "orders", to: "payments", rps: 8, health: healthOf("payments") },
    { from: "catalog", to: "redis", rps: 70, health: "healthy" },
    { from: "payments", to: "provider", rps: 12, health: healthOf("payments") },
    { from: "inventory", to: "redis", rps: 18, health: "healthy" },
  ];
  return { nodes, edges };
}

export function mockService(project: string, env: EnvName, range: TimeRange, name: string): ServiceDetail | null {
  if (env === "dev") return null;
  const seed = servicesFor(project).find((item) => item.name === name);
  if (!seed) return null;
  const summary = toService(seed, env, range, project);
  const scale = envScale(env);
  const { end } = windowFor(range);
  const endpoints = endpointsFor(project)
    .filter((item) => item.service === name)
    .map((item) => toEndpoint(item, env, range, project));
  const hosts = Array.from({ length: seed.instances }, (_, index) => {
    const hot = seed.health === "critical" ? 18 : seed.health === "degraded" ? 8 : 0;
    return {
      host: `iad1-${name}-${index + 1}`,
      cpu: Math.min(96, Math.round(38 * scale.cpu + hot + index * 3)),
      mem: Math.min(94, Math.round(54 * scale.cpu + hot * 0.6 + index * 2)),
      status: summary.health,
    };
  });
  return {
    ...summary,
    latency: timeseries(
      "response_time",
      range,
      [
        { name: "p50", points: buildPoints(`${name}-p50`, range, summary.latencyMs * 0.6, 12, seed.boost, project) },
        { name: "p95", points: buildPoints(`${name}-p95`, range, summary.latencyMs, 20, seed.boost, project) },
      ],
      project,
    ),
    errors: timeseries(
      "error_rate",
      range,
      [{ name: "errors", points: buildPoints(`${name}-err`, range, summary.errorRate, Math.max(0.05, summary.errorRate * 0.3), 1, project) }],
      project,
    ),
    endpoints,
    dependencies: graphFor(project, env),
    hosts,
    deploys: deployMoments(project, end).map((deploy) => ({
      time: deploy.time,
      version: deploy.version,
      note: deploy.note,
    })),
  };
}

export function mockEndpoints(project: string, env: EnvName, range: TimeRange): EndpointRow[] {
  if (env === "dev") return [];
  return endpointsFor(project).map((item) => toEndpoint(item, env, range, project));
}

function histogram(p95: number, calls: number): HistogramBucket[] {
  const labels = ["0–50", "50–100", "100–200", "200–400", "400–800", "800–1600", "1600+"];
  const centers = [25, 75, 150, 300, 600, 1200, 2000];
  const weights = centers.map((center) => Math.exp(-Math.abs(Math.log((center + 1) / (p95 + 1))) * 2.1));
  const sum = weights.reduce((total, weight) => total + weight, 0);
  const total = Math.max(40, calls * 8);
  return labels.map((label, index) => ({ label, count: Math.max(1, Math.round((weights[index] / sum) * total)) }));
}

function statuses(calls: number, errorRate: number): StatusSlice[] {
  const errors = Math.round(calls * (errorRate / 100) * 40);
  const ok = Math.max(10, calls * 30 - errors);
  return [
    { code: "200", count: Math.round(ok * 0.86) },
    { code: "201", count: Math.round(ok * 0.08) },
    { code: "400", count: Math.max(0, Math.round(errors * 0.25)) },
    { code: "404", count: Math.max(0, Math.round(errors * 0.15)) },
    { code: "500", count: Math.max(0, Math.round(errors * 0.4)) },
    { code: "504", count: Math.max(0, Math.round(errors * 0.2)) },
  ].filter((slice) => slice.count > 0);
}

function tracesFor(seed: EndpointSeed, now: number): SlowTrace[] {
  return [1.4, 1.15, 0.95, 0.8].map((factor, index) => ({
    id: `tr_${seed.service.slice(0, 3)}_${(index + 3).toString(16)}${seed.route.length}`,
    durationMs: Math.round(seed.p99Ms * factor),
    status: index === 0 && seed.errorRate > 1 ? 504 : 200,
    time: now - (index + 1) * 7 * 60_000,
  }));
}

export function mockEndpoint(project: string, env: EnvName, range: TimeRange, key: string): EndpointDetail | null {
  if (env === "dev") return null;
  const seed = endpointsFor(project).find((item) => endpointKey(item.method, item.route) === key);
  if (!seed) return null;
  const row = toEndpoint(seed, env, range, project);
  const scale = envScale(env);
  const service = servicesFor(project).find((item) => item.name === seed.service);
  const names = ["App", "DB", "Cache", "External"];
  const timeSpent: TimeSpent[] = names.map((name, index) => ({
    name,
    ms: Math.round(seed.spent[index] * scale.latency),
  }));
  return {
    ...row,
    histogram: histogram(row.p95Ms, row.calls),
    statuses: statuses(row.calls, row.errorRate),
    throughput: timeseries(
      "throughput",
      range,
      [{ name: "requests", points: buildPoints(`${key}-rpm`, range, row.calls, row.calls * 0.08, 1, project) }],
      project,
    ),
    latency: timeseries(
      "response_time",
      range,
      [
        { name: "p50", points: buildPoints(`${key}-p50`, range, row.avgMs, row.avgMs * 0.08, service?.boost ?? 1, project) },
        { name: "p95", points: buildPoints(`${key}-p95`, range, row.p95Ms, row.p95Ms * 0.07, service?.boost ?? 1, project) },
        { name: "p99", points: buildPoints(`${key}-p99`, range, row.p99Ms, row.p99Ms * 0.06, service?.boost ?? 1, project) },
      ],
      project,
    ),
    timeSpent,
    traces: tracesFor(seed, Date.now()),
  };
}

function bundle(seed: string, range: TimeRange, project: string, cpuBase: number, memBase: number, boost: number): ResourceBundle {
  return {
    cpu: timeseries("cpu", range, [{ name: "cpu", points: buildPoints(`${seed}-cpu`, range, cpuBase, 5, boost, project) }], project),
    memory: timeseries("memory", range, [{ name: "memory", points: buildPoints(`${seed}-mem`, range, memBase, 2.5, 1.03, project) }], project),
    disk: timeseries(
      "disk",
      range,
      [
        { name: "read", points: buildPoints(`${seed}-dr`, range, 18, 6, 1, project) },
        { name: "write", points: buildPoints(`${seed}-dw`, range, 9, 3, boost, project) },
      ],
      project,
    ),
    network: timeseries(
      "network",
      range,
      [
        { name: "in", points: buildPoints(`${seed}-in`, range, 22, 5, 1, project) },
        { name: "out", points: buildPoints(`${seed}-out`, range, 31, 6, 1, project) },
      ],
      project,
    ),
    lag: timeseries("lag", range, [{ name: "lag", points: buildPoints(`${seed}-lag`, range, cpuBase > 70 ? 28 : 8, 4, boost, project) }], project),
  };
}

export function mockResources(project: string, env: EnvName, range: TimeRange): ResourcesPayload {
  if (env === "dev") {
    return {
      empty: true,
      hosts: [],
      aggregate: bundle("empty", range, project, 0, 0, 1),
      byHost: {},
      heatmap: { hosts: [], times: [], values: [] },
    };
  }
  const scale = envScale(env);
  const hosts: HostSnapshot[] = [];
  servicesFor(project).forEach((service) => {
    const hot = service.health === "critical" ? 22 : service.health === "degraded" ? 10 : 0;
    for (let index = 0; index < service.instances; index += 1) {
      hosts.push({
        host: `iad1-${service.name}-${index + 1}`,
        service: service.name,
        cpu: Math.min(97, Math.round((36 + hot + index * 4) * scale.cpu)),
        mem: Math.min(95, Math.round((52 + hot * 0.7 + index * 3) * scale.cpu)),
        disk: round(12 + index * 3 + (service.health === "critical" ? 8 : 0), 1),
        net: round(20 + index * 4, 1),
      });
    }
  });
  const byHost: Record<string, ResourceBundle> = {};
  hosts.forEach((host) => {
    byHost[host.host] = bundle(host.host, range, project, host.cpu, host.mem, host.cpu > 75 ? 1.08 : 1);
  });
  const { start, end, step } = windowFor(range);
  const times: string[] = [];
  const bucket = Math.max(step, Math.round((end - start) / 8));
  for (let time = start; time <= end; time += bucket) {
    times.push(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(time));
    if (times.length >= 8) break;
  }
  const values: [number, number, number][] = [];
  hosts.forEach((host, y) => {
    times.forEach((_, x) => {
      const wave = Math.sin((x + y) / 2) * 6;
      values.push([x, y, Math.max(4, Math.min(99, Math.round(host.cpu + wave - 4)))]);
    });
  });
  const avgCpu = hosts.reduce((total, host) => total + host.cpu, 0) / Math.max(1, hosts.length);
  const avgMem = hosts.reduce((total, host) => total + host.mem, 0) / Math.max(1, hosts.length);
  return {
    empty: false,
    hosts,
    aggregate: bundle("all", range, project, avgCpu, avgMem, project === "shop-api" ? 1.1 : 1),
    byHost,
    heatmap: { hosts: hosts.map((host) => host.host), times, values },
  };
}

function errorGroups(project: string, env: EnvName): ErrorGroup[] {
  if (env === "dev") return [];
  const scale = env === "staging" ? 0.32 : 1;
  const now = Date.now();
  const seeds = project === "billing-api" ? BILLING_ERRORS : SHOP_ERRORS;
  return seeds.map((seed) => ({
    fingerprint: seed.fingerprint,
    type: seed.type,
    message: seed.message,
    count: Math.max(1, Math.round(seed.count * scale)),
    users: Math.max(1, Math.round(seed.users * scale)),
    firstSeen: now - seed.ageHours * 3_600_000,
    lastSeen: now - Math.min(seed.ageHours, 0.4) * 3_600_000 * 0.15,
    service: seed.service,
    route: seed.route,
    trend: spark(buildPoints(seed.fingerprint, "24h", seed.count / 80, 4, 1.2, project), 20),
  }));
}

export function mockErrors(project: string, env: EnvName): ErrorGroup[] {
  return errorGroups(project, env);
}

export function mockError(project: string, env: EnvName, fingerprint: string): ErrorDetail | null {
  const group = errorGroups(project, env).find((item) => item.fingerprint === fingerprint);
  const seeds = project === "billing-api" ? BILLING_ERRORS : SHOP_ERRORS;
  const seed = seeds.find((item) => item.fingerprint === fingerprint);
  if (!group || !seed) return null;
  return {
    ...group,
    stack: seed.stack,
    context: [
      { label: "Route", value: seed.route },
      { label: "Service", value: seed.service },
      { label: "Environment", value: env },
      { label: "Release", value: project === "billing-api" ? "v1.8.0" : "v2.14.1" },
      { label: "Region", value: "iad1" },
    ],
  };
}

export function mockRules(project: string) {
  return mergeRules(project, rulesFor(project));
}

export function mockIncidents(project: string, env: EnvName) {
  return mergeIncidents(incidentList(project, env));
}

const DEFAULT_KEYS: Record<string, string> = {
  "shop-api": "po_live_8c2f91ab7d4f2a",
  "billing-api": "po_live_11ae04c88b19d0",
};

export function mockSettings(projectSlug: string): SettingsPayload {
  const project = projectBySlug(projectSlug);
  return {
    project,
    environments: [
      { name: "prod", region: "iad1" },
      { name: "staging", region: "iad1" },
      { name: "dev", region: "local" },
    ],
    apiKey: currentKey(project.slug, DEFAULT_KEYS[project.slug] ?? "po_live_demo"),
    team: [
      { name: "Avery Chen", email: "avery@pulseops.dev", role: "Owner" },
      { name: "Mina Patel", email: "mina@pulseops.dev", role: "Admin" },
      { name: "Jordan Lee", email: "jordan@pulseops.dev", role: "Developer" },
      { name: "Sam Okonkwo", email: "sam@pulseops.dev", role: "Viewer" },
    ],
    channels: [
      { id: "email", kind: "Email", target: "ops@pulseops.dev", enabled: true },
      { id: "slack", kind: "Slack", target: project.slug === "shop-api" ? "#shop-api-alerts" : "#billing-alerts", enabled: true },
      { id: "webhook", kind: "Webhook", target: "Not configured", enabled: false },
    ],
    retention: [
      { label: "Raw requests", value: "7 days" },
      { label: "1-minute rollups", value: "30 days" },
      { label: "Errors", value: "30 days" },
    ],
  };
}

export function endpointHealth(row: Pick<EndpointRow, "errorRate" | "p95Ms" | "apdex">): Health {
  if (row.errorRate >= 2 || row.p95Ms >= 1500 || row.apdex < 0.85) return "critical";
  if (row.errorRate >= 0.8 || row.p95Ms >= 500 || row.apdex < 0.94) return "degraded";
  return "healthy";
}
