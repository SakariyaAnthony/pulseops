export const TIME_RANGES = ["15m", "1h", "6h", "24h", "7d"] as const;
export type TimeRange = (typeof TIME_RANGES)[number];

export const ENVIRONMENTS = ["prod", "staging", "dev"] as const;
export type EnvName = (typeof ENVIRONMENTS)[number];

export type Health = "healthy" | "degraded" | "critical";
export type Severity = "critical" | "warning" | "info";
export type IncidentStatus = "firing" | "acknowledged" | "resolved";

export type Scope = {
  project: string;
  env: EnvName;
  range: TimeRange;
  chaos: boolean;
};

export type Point = [number, number];

export type Series = {
  name: string;
  points: Point[];
};

export type Deploy = {
  time: number;
  version: string;
};

export type Timeseries = {
  metric: string;
  resolution: string;
  series: Series[];
  deploys: Deploy[];
};

export type Project = {
  id: string;
  name: string;
  slug: string;
};

export type Kpi = {
  id: string;
  label: string;
  value: number;
  delta: number;
  intent: "lower" | "higher";
  unit: "ms" | "rpm" | "pct" | "apdex";
  spark: number[];
};

export type ServiceSummary = {
  name: string;
  description: string;
  health: Health;
  latencyMs: number;
  rpm: number;
  errorRate: number;
  instances: number;
  version: string;
  language: string;
  spark: number[];
  /** Set when the service is built from a runtime scan instead of live SDK traffic. */
  capture?: { at: string; calls: number; routes: number; baseUrl: string };
};

export type EndpointRow = {
  key: string;
  method: string;
  route: string;
  service: string;
  calls: number;
  /** Timings are NaN when a capture has too few samples to measure them. The formatters show a dash. */
  avgMs: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  apdex: number;
  trend: number[];
  /** True for rows built from a runtime scan instead of live SDK traffic. */
  captured?: boolean;
};

export type HistogramBucket = { label: string; count: number };
export type StatusSlice = { code: string; count: number };
export type TimeSpent = { name: string; ms: number };
export type SlowTrace = {
  id: string;
  durationMs: number;
  status: number;
  time: number;
};

export type EndpointDetail = EndpointRow & {
  histogram: HistogramBucket[];
  statuses: StatusSlice[];
  throughput: Timeseries;
  latency: Timeseries;
  timeSpent: TimeSpent[];
  traces: SlowTrace[];
};

export type Incident = {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  status: IncidentStatus;
  service: string;
  startedAt: number;
  project: string;
  env: EnvName;
};

export type AlertRule = {
  id: string;
  project: string;
  name: string;
  metric: string;
  operator: "above" | "below";
  threshold: number;
  window: string;
  severity: Severity;
  channels: string[];
  enabled: boolean;
};

export type ErrorGroup = {
  fingerprint: string;
  type: string;
  message: string;
  count: number;
  users: number;
  firstSeen: number;
  lastSeen: number;
  service: string;
  route: string;
  trend: number[];
};

export type ErrorDetail = ErrorGroup & {
  stack: string;
  context: { label: string; value: string }[];
};

export type InsightPreview = {
  id: string;
  severity: Severity;
  title: string;
  body: string;
  href: string;
};

export type Overview = {
  empty: boolean;
  kpis: Kpi[];
  responseTime: Timeseries;
  throughput: Timeseries;
  cpuMemory: Timeseries;
  slowEndpoints: EndpointRow[];
  services: ServiceSummary[];
  incidents: Incident[];
  insights: InsightPreview[];
};

export type GraphNode = {
  id: string;
  label: string;
  kind: "client" | "gateway" | "service" | "data";
  health: Health;
};

export type GraphEdge = {
  from: string;
  to: string;
  rps: number;
  health: Health;
};

export type ServiceDetail = ServiceSummary & {
  latency: Timeseries;
  errors: Timeseries;
  endpoints: EndpointRow[];
  dependencies: { nodes: GraphNode[]; edges: GraphEdge[] };
  hosts: { host: string; cpu: number; mem: number; status: Health }[];
  deploys: { time: number; version: string; note: string }[];
};

export type HostSnapshot = {
  host: string;
  service: string;
  cpu: number;
  mem: number;
  disk: number;
  net: number;
};

export type ResourceBundle = {
  cpu: Timeseries;
  memory: Timeseries;
  disk: Timeseries;
  network: Timeseries;
  lag: Timeseries;
};

export type ResourcesPayload = {
  empty: boolean;
  hosts: HostSnapshot[];
  aggregate: ResourceBundle;
  byHost: Record<string, ResourceBundle>;
  heatmap: {
    hosts: string[];
    times: string[];
    values: [number, number, number][];
  };
};

export type ScanSetup = {
  repositoryPath: string;
  framework: string;
  baseUrl: string;
  routes: string[];
  viewportWidth: number;
  viewportHeight: number;
  timeoutMs: number;
  startCommand: string;
};

export type ScanRun = {
  id: string;
  projectId: string;
  status: string;
  mode: string;
  progress: { stage?: string; message?: string };
  errorSummary: string;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  config: {
    repositoryPath: string;
    baseUrl: string;
    framework: string;
    routes: string[];
    viewportWidth: number | null;
    viewportHeight: number | null;
    timeoutMs: number | null;
  };
};

export type ScanAssetRow = {
  id: string;
  filePath: string;
  assetType: string;
  fileSizeBytes: number | null;
  contentHash: string;
  classification: string;
  explanation: string;
  confidence: string;
  duplicateOf: string;
  references: string[];
  routes: string[];
  transferBytes: number | null;
  durationMs: number | null;
  failureType: string;
};

export type AssetIssue = {
  filePath: string;
  assetType: string;
  sizeBytes: number | null;
  transferBytes: number | null;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  routes: string[];
  references: string[];
  severity: string;
  notes: string[];
  kinds: string[];
  failureType: string;
  statusCode: number | null;
  duplicateOf: string;
  confidence: string;
  inRepository: boolean;
};

export type AssetInsights = {
  totalAssets: number;
  byType: Record<
    string,
    { count: number; sizeBytes: number; transferBytes: number }
  >;
  unusedBytes: number;
  duplicateBytes: number;
  largeBytes: number;
  large: AssetIssue[];
  quality: AssetIssue[];
  failed: AssetIssue[];
  slow: AssetIssue[];
  unused: AssetIssue[];
  duplicates: AssetIssue[];
  missing: AssetIssue[];
};

export type AssetSummary = {
  insights: AssetInsights;
  counts: Record<string, number>;
  referenced: number;
  potentiallyUnused: number;
  missingReference: number;
  totalSizeBytes: number;
  totalTransferBytes: number;
  largest: { filePath: string; fileSizeBytes: number }[];
  duplicates: { filePath: string; duplicateOf: string }[];
  optimization: { filePath: string; notes: string[] }[];
  lazyLoading: { filePath: string; note: string }[];
  loadPerformance: {
    filePath: string;
    durationMs: number | null;
    transferBytes: number | null;
    failureType: string;
  }[];
  locations: { filePath: string; references: string[]; routes: string[] }[];
};

export type ScanEndpoint = {
  method: string;
  endpointTemplate: string;
  count: number;
  sampleCount: number;
  errorRate: number | null;
  avgMs: number | null;
  apdex: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
};

/** API performance built from the latest runtime scan of the running app. */
export type ApiCapture = {
  scan: ScanRun;
  endpoints: EndpointRow[];
  service: ServiceSummary;
};

export type ScanRequest = {
  route: string;
  method: string;
  endpointTemplate: string;
  statusCode: number | null;
  durationMs: number | null;
  transferBytes: number | null;
  failureType: string;
};

export type ScanPage = {
  route: string;
  metricSource: string;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
  totalTransferBytes: number | null;
  durationMs: number | null;
  sampleCount: number;
  status: string;
  errorSummary: string;
};

export type SettingsPayload = {
  project: Project;
  environments: { name: EnvName; region: string }[];
  apiKey: string;
  team: { name: string; email: string; role: string }[];
  channels: { id: string; kind: string; target: string; enabled: boolean }[];
  retention: { label: string; value: string }[];
  scan: ScanSetup;
};

export type SessionUser = {
  token: string;
  email: string;
  name: string;
  role: "admin" | "member";
};

export type RuleInput = {
  name: string;
  metric: string;
  operator: "above" | "below";
  threshold: number;
  window: string;
  severity: Severity;
  channels: string[];
};
