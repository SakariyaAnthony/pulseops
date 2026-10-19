import { formatClock } from "@/lib/format";
import type {
  AlertRule,
  EndpointDetail,
  EndpointRow,
  EnvName,
  ErrorDetail,
  ErrorGroup,
  Health,
  HistogramBucket,
  HostSnapshot,
  Incident,
  IncidentStatus,
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
  Severity,
  StatusSlice,
  Timeseries,
} from "@/lib/api/types";

const MEM_CRITICAL_MB = 1800;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sparkOf(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((point) => (Array.isArray(point) ? num(point[1]) : num(point)));
}

function pointsOf(value: unknown): Point[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    return [[num(point[0]), num(point[1])] as Point];
  });
}

function seriesOf(value: unknown, rename?: string): Series[] {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.series)) return [];
  return record.series.flatMap((item) => {
    const series = asRecord(item);
    if (!series || typeof series.name !== "string") return [];
    return [{ name: rename ?? series.name, points: pointsOf(series.points) }];
  });
}

function deploysOf(value: unknown) {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.deploys)) return [];
  return record.deploys.flatMap((item) => {
    const deploy = asRecord(item);
    if (!deploy || typeof deploy.version !== "string") return [];
    return [{ time: num(deploy.time), version: deploy.version }];
  });
}

function timeseriesOf(value: unknown, metric: string, rename?: string): Timeseries {
  const record = asRecord(value);
  return {
    metric,
    resolution: typeof record?.resolution === "string" ? record.resolution : "1m",
    series: seriesOf(value, rename),
    deploys: deploysOf(value),
  };
}

function emptySeries(metric: string): Timeseries {
  return { metric, resolution: "1m", series: [], deploys: [] };
}

function healthOf(value: unknown): Health {
  return value === "critical" || value === "degraded" ? value : "healthy";
}

function severityOf(value: unknown): Severity {
  return value === "warning" || value === "info" ? value : "critical";
}

function statusOf(value: unknown): IncidentStatus {
  return value === "acknowledged" || value === "resolved" ? value : "firing";
}

function envOf(value: unknown): EnvName {
  return value === "staging" || value === "dev" ? value : "prod";
}

function operatorOf(value: unknown): AlertRule["operator"] {
  return value === "lt" || value === "lte" || value === "below" ? "below" : "above";
}

function memPercent(mb: number): number {
  if (mb <= 0) return 0;
  return Math.min(100, (mb / MEM_CRITICAL_MB) * 100);
}

function bytesToMb(bps: number): number {
  return bps / (1024 * 1024);
}

function liveKpi(id: string, label: string, value: unknown, intent: Kpi["intent"], unit: Kpi["unit"]): Kpi {
  const record = asRecord(value);
  return {
    id,
    label,
    value: num(record?.value),
    delta: num(record?.delta_pct),
    intent,
    unit,
    spark: sparkOf(record?.sparkline),
  };
}

function scaleMemory(series: Timeseries): Timeseries {
  return {
    ...series,
    series: series.series.map((item) => ({
      ...item,
      points: item.points.map((point) => [point[0], memPercent(point[1])]),
    })),
  };
}

export function adaptProjects(value: unknown): Project[] | null {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.projects) ? record.projects : null;
  if (!list) return null;
  return list.flatMap((item) => {
    const project = asRecord(item);
    if (!project || typeof project.slug !== "string" || typeof project.name !== "string") return [];
    return [{ id: text(project.id) || project.slug, name: project.name, slug: project.slug }];
  });
}

export function adaptLiveOverview(value: unknown): Overview | null {
  const record = asRecord(value);
  const kpis = asRecord(record?.kpis);
  if (!record || !kpis || !("avg_ms" in kpis)) return null;
  const response = timeseriesOf(record.response_time, "response_time");
  const throughput = timeseriesOf(record.throughput, "throughput", "requests");
  const resources = asRecord(record.resources);
  const cpu = timeseriesOf(resources?.cpu, "cpu");
  const memory = scaleMemory(timeseriesOf(resources?.memory, "memory"));
  return {
    empty: adaptServices(record).length === 0 && num(asRecord(kpis.avg_ms)?.value) === 0,
    kpis: [
      liveKpi("avg", "Avg response", kpis.avg_ms, "lower", "ms"),
      liveKpi("p95", "p95", kpis.p95_ms, "lower", "ms"),
      liveKpi("rpm", "Req / min", kpis.rpm, "higher", "rpm"),
      liveKpi("error", "Error rate", kpis.error_pct, "lower", "pct"),
      liveKpi("apdex", "Apdex", kpis.apdex, "higher", "apdex"),
    ],
    responseTime: response,
    throughput,
    cpuMemory: {
      metric: "resources",
      resolution: cpu.resolution,
      series: [
        { name: "cpu", points: cpu.series[0]?.points ?? [] },
        { name: "memory", points: memory.series[0]?.points ?? [] },
      ],
      deploys: cpu.deploys,
    },
    slowEndpoints: adaptEndpointRows(record.slow_endpoints),
    services: adaptServices(record),
    incidents: adaptIncidents(record.incidents, text(record.slug) || "shop-api"),
    insights: [],
  };
}

export function adaptServices(value: unknown): ServiceSummary[] {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.services) ? record.services : [];
  return list.flatMap((item) => {
    const service = asRecord(item);
    if (!service || typeof service.name !== "string") return [];
    return [serviceSummary(service)];
  });
}

function serviceSummary(service: Record<string, unknown>): ServiceSummary {
  return {
    name: text(service.name),
    description: text(service.description),
    health: healthOf(service.health),
    latencyMs: num(service.latencyMs ?? service.avg_ms),
    rpm: num(service.rpm),
    errorRate: num(service.errorRate ?? service.error_pct),
    instances: num(service.instances),
    version: text(service.version),
    language: text(service.language),
    spark: sparkOf(service.spark ?? service.sparkline),
  };
}

export function adaptServiceDetail(value: unknown): ServiceDetail | null {
  const record = asRecord(value);
  if (!record || typeof record.name !== "string") return null;
  const resources = asRecord(record.resources);
  const cpu = num(resources?.cpu_pct);
  const mem = memPercent(num(resources?.mem_rss_mb));
  const summary = serviceSummary(record);
  const hosts =
    cpu > 0 || mem > 0
      ? [{ host: "average", cpu, mem, status: summary.health }]
      : [];
  return {
    ...summary,
    latency: timeseriesOf(record.response_time, "response_time"),
    errors: emptySeries("error_rate"),
    endpoints: adaptEndpointRows(record.endpoints),
    dependencies: { nodes: [], edges: [] },
    hosts,
    deploys: Array.isArray(record.deploys)
      ? record.deploys.flatMap((item) => {
          const deploy = asRecord(item);
          if (!deploy || typeof deploy.version !== "string") return [];
          const note = text(deploy.commit_sha) || text(deploy.note) || "Recorded deploy";
          return [{ time: num(deploy.time), version: deploy.version, note }];
        })
      : [],
  };
}

export function adaptEndpointRows(value: unknown): EndpointRow[] {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.endpoints) ? record.endpoints : [];
  return list.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.route !== "string" || typeof row.method !== "string") return [];
    return [
      {
        key: text(row.key) || `${row.method} ${row.route}`,
        method: row.method,
        route: row.route,
        service: text(row.service),
        calls: num(row.calls),
        avgMs: num(row.avgMs ?? row.avg_ms),
        p95Ms: num(row.p95Ms ?? row.p95_ms),
        p99Ms: num(row.p99Ms ?? row.p99_ms),
        errorRate: num(row.errorRate ?? row.error_pct),
        apdex: num(row.apdex),
        trend: sparkOf(row.trend ?? row.sparkline),
      },
    ];
  });
}

function histogramOf(value: unknown): HistogramBucket[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const bucket = asRecord(item);
    if (!bucket) return [];
    const edge = bucket.le;
    const label =
      typeof bucket.label === "string"
        ? bucket.label
        : edge == null
          ? "> 5s"
          : `≤ ${num(edge) >= 1000 ? `${num(edge) / 1000}s` : `${num(edge)} ms`}`;
    return [{ label, count: num(bucket.count) }];
  });
}

function statusesOf(value: unknown): StatusSlice[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const slice = asRecord(item);
      if (!slice) return [];
      const code = text(slice.code);
      if (!code) return [];
      return [{ code, count: num(slice.count) }];
    });
  }
  const record = asRecord(value);
  if (!record) return [];
  return ["2xx", "3xx", "4xx", "5xx"].flatMap((code) => {
    const count = num(record[code]);
    return count > 0 ? [{ code, count }] : [];
  });
}

export function adaptEndpointDetail(value: unknown): EndpointDetail | null {
  const record = asRecord(value);
  const rows = adaptEndpointRows(record ? [record] : null);
  const row = rows[0];
  if (!record || !row || !("histogram" in record || "status" in record || "response_time" in record)) return null;
  const throughput = timeseriesOf(record.throughput, "throughput", "requests");
  return {
    ...row,
    histogram: histogramOf(record.histogram),
    statuses: statusesOf(record.statuses ?? record.status),
    throughput: {
      ...throughput,
      series: throughput.series.map((item) => ({ ...item, name: "requests" })),
    },
    latency: timeseriesOf(record.response_time ?? record.latency, "response_time"),
    timeSpent: [],
    traces: [],
  };
}

function namedPoints(metric: unknown, host: string | null, scale: (value: number) => number = (value) => value): Point[] {
  const record = asRecord(metric);
  const series = Array.isArray(record?.series) ? record.series : [];
  if (host) {
    const match = series.map(asRecord).find((item) => item?.name === host);
    return pointsOf(match?.points).map((point) => [point[0], scale(point[1])]);
  }
  const buckets = new Map<number, number[]>();
  for (const item of series) {
    const row = asRecord(item);
    for (const point of pointsOf(row?.points)) {
      const values = buckets.get(point[0]) ?? [];
      values.push(scale(point[1]));
      buckets.set(point[0], values);
    }
  }
  return [...buckets.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([time, values]) => [time, values.reduce((sum, value) => sum + value, 0) / values.length]);
}

function bundle(metrics: Record<string, unknown>, host: string | null): ResourceBundle {
  const cpu = asRecord(metrics.cpu_pct);
  const resolution = text(cpu?.resolution) || "1m";
  const deploys = deploysOf(cpu);
  const make = (metric: string, points: Point[], name: string): Timeseries => ({
    metric,
    resolution,
    series: [{ name, points }],
    deploys,
  });
  const diskRead = namedPoints(metrics.disk_read_bps, host, bytesToMb);
  const diskWrite = namedPoints(metrics.disk_write_bps, host, bytesToMb);
  const netIn = namedPoints(metrics.net_in_bps, host, bytesToMb);
  const netOut = namedPoints(metrics.net_out_bps, host, bytesToMb);
  return {
    cpu: make("cpu", namedPoints(metrics.cpu_pct, host), "cpu"),
    memory: make("memory", namedPoints(metrics.mem_rss_mb, host, memPercent), "memory"),
    disk: { metric: "disk", resolution, series: [{ name: "read", points: diskRead }, { name: "write", points: diskWrite }], deploys },
    network: { metric: "network", resolution, series: [{ name: "in", points: netIn }, { name: "out", points: netOut }], deploys },
    lag: make("lag", namedPoints(metrics.event_loop_lag_ms, host), "lag"),
  };
}

function latest(points: Point[]): number {
  return points.length ? points[points.length - 1][1] : 0;
}

export function adaptResources(value: unknown): ResourcesPayload | null {
  const record = asRecord(value);
  if (!record || !asRecord(record.metrics) || !Array.isArray(record.hosts)) return null;
  const metrics = asRecord(record.metrics) ?? {};
  const cpu = asRecord(metrics.cpu_pct);
  const series = Array.isArray(cpu?.series) ? cpu.series : [];
  const hosts: HostSnapshot[] = series.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.name !== "string") return [];
    const cpuPoints = namedPoints(metrics.cpu_pct, row.name);
    return [
      {
        host: row.name,
        service: "",
        cpu: latest(cpuPoints),
        mem: latest(namedPoints(metrics.mem_rss_mb, row.name, memPercent)),
        disk: latest(namedPoints(metrics.disk_read_bps, row.name, bytesToMb)),
        net: latest(namedPoints(metrics.net_in_bps, row.name, bytesToMb)),
      },
    ];
  });
  const byHost: Record<string, ResourceBundle> = {};
  for (const host of hosts) byHost[host.host] = bundle(metrics, host.host);
  const times = downsample(namedPoints(metrics.cpu_pct, hosts[0]?.host ?? null).map((point) => point[0]));
  const values: [number, number, number][] = [];
  hosts.forEach((host, y) => {
    const points = namedPoints(metrics.cpu_pct, host.host);
    times.forEach((time, x) => {
      values.push([x, y, nearest(points, time)]);
    });
  });
  return {
    empty: hosts.length === 0,
    hosts,
    aggregate: bundle(metrics, null),
    byHost,
    heatmap: {
      hosts: hosts.map((host) => host.host),
      times: times.map((time) => formatClock(time)),
      values,
    },
  };
}

function downsample(times: number[]): number[] {
  if (times.length <= 8) return times;
  const step = Math.ceil(times.length / 8);
  return times.filter((_, index) => index % step === 0).slice(0, 8);
}

function nearest(points: Point[], time: number): number {
  let best = points[0];
  for (const point of points) {
    if (Math.abs(point[0] - time) < Math.abs(best[0] - time)) best = point;
  }
  return best ? best[1] : 0;
}

export function adaptErrors(value: unknown): ErrorGroup[] | null {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.groups) ? record.groups : null;
  if (!list) return null;
  return list.flatMap((item) => {
    const group = asRecord(item);
    if (!group || typeof group.fingerprint !== "string") return [];
    return [errorGroup(group)];
  });
}

function errorGroup(group: Record<string, unknown>): ErrorGroup {
  return {
    fingerprint: text(group.fingerprint),
    type: text(group.type) || "Error",
    message: text(group.message),
    count: num(group.count),
    users: num(group.users),
    firstSeen: stamp(group.firstSeen ?? group.first_seen),
    lastSeen: stamp(group.lastSeen ?? group.last_seen),
    service: text(group.service),
    route: text(group.route),
    trend: sparkOf(group.trend ?? group.sparkline),
  };
}

function stamp(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function adaptErrorDetail(value: unknown): ErrorDetail | null {
  const record = asRecord(value);
  if (!record || typeof record.fingerprint !== "string" || !("stack" in record)) return null;
  const group = errorGroup(record);
  const events = Array.isArray(record.events) ? record.events : [];
  const latest = asRecord(events[0]);
  const context = asRecord(latest?.context) ?? {};
  const pairs = [
    { label: "Route", value: group.route || "—" },
    { label: "Service", value: group.service || "—" },
    ...Object.entries(context).map(([label, item]) => ({ label, value: String(item) })),
  ];
  return { ...group, stack: text(record.stack), context: pairs };
}

export function adaptRules(value: unknown, project: string): AlertRule[] | null {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.rules) ? record.rules : null;
  if (!list) return null;
  return list.flatMap((item) => {
    const rule = adaptRule(item, project);
    return rule ? [rule] : [];
  });
}

export function adaptRule(value: unknown, project: string): AlertRule | null {
  const rule = asRecord(value);
  if (!rule || typeof rule.metric !== "string" || !("threshold" in rule)) return null;
  return {
    id: text(rule.id),
    project: text(rule.project) || project,
    name: text(rule.name) || text(rule.metric),
    metric: rule.metric,
    operator: operatorOf(rule.operator),
    threshold: num(rule.threshold),
    window: text(rule.window),
    severity: severityOf(rule.severity),
    channels: Array.isArray(rule.channels) ? rule.channels.map((item) => String(item)) : [],
    enabled: rule.enabled !== false,
  };
}

export function adaptIncidents(value: unknown, project: string, env?: EnvName): Incident[] {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.incidents) ? record.incidents : [];
  return list.flatMap((item) => {
    const incident = asRecord(item);
    if (!incident || typeof incident.id !== "string" || typeof incident.title !== "string") return [];
    const environment = envOf(incident.environment ?? incident.env);
    const hasEnv = incident.environment != null || incident.env != null;
    if (env && hasEnv && environment !== env) return [];
    return [
      {
        id: incident.id,
        title: incident.title,
        detail: text(incident.detail),
        severity: severityOf(incident.severity),
        status: statusOf(incident.status),
        service: text(incident.rule_name) || text(incident.service) || project,
        startedAt: stamp(incident.startedAt ?? incident.started_at) || Date.now(),
        project,
        env: environment,
      },
    ];
  });
}

export function adaptSettings(value: unknown, slug: string): SettingsPayload | null {
  const record = asRecord(value);
  if (!record || typeof record.slug !== "string") return null;
  const keys = Array.isArray(record.api_keys) ? record.api_keys : [];
  const first = asRecord(keys[0]);
  const prefix = text(first?.prefix) || text(first?.demo_token);
  const environments = (Array.isArray(record.environments) ? record.environments : []).flatMap((item) => {
    const env = asRecord(item);
    const name = text(env?.name);
    if (name !== "prod" && name !== "staging" && name !== "dev") return [];
    return [{ name, region: "Not configured" } as const];
  });
  return {
    project: { id: text(record.id) || slug, name: text(record.name) || slug, slug: record.slug },
    environments,
    apiKey: prefix,
    team: [],
    channels: [],
    retention: [],
  };
}

export function adaptInsights(value: unknown): InsightPreview[] | null {
  const record = asRecord(value);
  const list = Array.isArray(value) ? value : record && Array.isArray(record.insights) ? record.insights : null;
  if (!list) return null;
  return list.flatMap((item) => {
    const insight = asRecord(item);
    if (!insight || typeof insight.title !== "string") return [];
    return [
      {
        id: text(insight.id) || insight.title,
        severity: severityOf(insight.severity),
        title: insight.title,
        body: text(insight.body) || text(insight.detail),
        href: text(insight.href) || "/overview",
      },
    ];
  });
}
