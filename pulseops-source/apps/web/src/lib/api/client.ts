import {
  ackIncident,
  addRule,
  currentKey,
  mergeIncidents,
  mergeRules,
  rotateKey,
  setRuleEnabled,
} from "@/lib/api/overrides";
import {
  mockEndpoint,
  mockEndpoints,
  mockError,
  mockErrors,
  mockIncidents,
  mockOverview,
  mockResources,
  mockRules,
  mockService,
  mockServices,
  mockSettings,
  projectBySlug,
  PROJECTS,
} from "@/lib/api/mock";
import type {
  AlertRule,
  EndpointDetail,
  EndpointRow,
  ErrorDetail,
  ErrorGroup,
  Health,
  Incident,
  IncidentStatus,
  Kpi,
  Overview,
  Point,
  Project,
  ResourcesPayload,
  RuleInput,
  Scope,
  Series,
  ServiceDetail,
  ServiceSummary,
  SessionUser,
  SettingsPayload,
  Severity,
  Timeseries,
} from "@/lib/api/types";
import { useUi } from "@/store/ui";

const DEMO_EMAIL = "demo@pulseops.dev";
const DEMO_PASSWORD = "pulseops-demo";

export function apiBase(): string {
  return (import.meta.env.VITE_API_URL || "http://127.0.0.1:47322").replace(/\/$/, "");
}

let apiState: "unknown" | "up" | "down" = "unknown";
let probe: Promise<boolean> | null = null;

export function probeApi(): Promise<boolean> {
  if (apiState === "up") return Promise.resolve(true);
  if (apiState === "down") return Promise.resolve(false);
  if (!probe) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 600);
    probe = fetch(`${apiBase()}/healthz`, { signal: controller.signal })
      .then((response) => response.ok)
      .catch(() => false)
      .then((ok) => {
        window.clearTimeout(timer);
        apiState = ok ? "up" : "down";
        if (!ok) {
          window.setTimeout(() => {
            apiState = "unknown";
            probe = null;
          }, 20_000);
        }
        return ok;
      });
  }
  return probe;
}

function readToken(): string | null {
  try {
    const raw = localStorage.getItem("pulseops-session");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } };
    return parsed.state?.token ?? null;
  } catch {
    return null;
  }
}

function mark(source: "api" | "mock") {
  if (useUi.getState().source !== source) useUi.getState().setSource(source);
}

async function pause(ms = 200) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryGet(path: string): Promise<unknown | null> {
  if (!(await probeApi())) return null;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${apiBase()}${path}`, { headers });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function trySend(path: string, method: string, body?: unknown): Promise<boolean> {
  if (!(await probeApi())) return false;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const token = readToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers["Content-Type"] = "application/json";
    const response = await fetch(`${apiBase()}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isOverview(value: unknown): value is Overview {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Overview>;
  return Array.isArray(record.kpis) && !!record.responseTime && Array.isArray(record.responseTime.series);
}

function isArrayOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
  return Array.isArray(value) && (value.length === 0 || check(value[0]));
}

function isService(value: unknown): value is ServiceSummary {
  return !!value && typeof value === "object" && "name" in value && "latencyMs" in value;
}

function isEndpoint(value: unknown): value is EndpointRow {
  return !!value && typeof value === "object" && "route" in value && "p95Ms" in value;
}

function isError(value: unknown): value is ErrorGroup {
  return !!value && typeof value === "object" && "fingerprint" in value && "message" in value;
}

function isIncident(value: unknown): value is Incident {
  return !!value && typeof value === "object" && "status" in value && "severity" in value && "title" in value;
}

function isRule(value: unknown): value is AlertRule {
  return !!value && typeof value === "object" && "metric" in value && "threshold" in value;
}

function isResources(value: unknown): value is ResourcesPayload {
  return !!value && typeof value === "object" && "hosts" in value && "aggregate" in value;
}

function isDetail(value: unknown): value is EndpointDetail {
  return isEndpoint(value) && "histogram" in value && "timeSpent" in value;
}

function isServiceDetail(value: unknown): value is ServiceDetail {
  return isService(value) && "dependencies" in value;
}

function isErrorDetail(value: unknown): value is ErrorDetail {
  return isError(value) && "stack" in value;
}

async function load<T>(scope: Scope, path: string, fallback: () => T, accept: (value: unknown) => value is T): Promise<T> {
  if (scope.chaos) {
    await pause(280);
    throw new Error("The metrics query timed out before the rollup came back.");
  }
  const remote = await tryGet(path);
  if (remote && accept(remote)) {
    mark("api");
    return remote;
  }
  mark("mock");
  await pause();
  return fallback();
}

function query(scope: Scope) {
  return new URLSearchParams({ range: scope.range, env: scope.env }).toString();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function timeseriesOf(value: unknown, metric: string, rename?: string): Timeseries {
  const record = asRecord(value);
  const deploys = Array.isArray(record?.deploys)
    ? record.deploys.flatMap((item) => {
        const deploy = asRecord(item);
        if (!deploy || typeof deploy.version !== "string") return [];
        return [{ time: num(deploy.time), version: deploy.version }];
      })
    : [];
  return {
    metric,
    resolution: typeof record?.resolution === "string" ? record.resolution : "1m",
    series: seriesOf(value, rename),
    deploys,
  };
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

function adaptLiveOverview(value: unknown): Overview | null {
  const record = asRecord(value);
  const kpis = asRecord(record?.kpis);
  if (!record || !kpis || Array.isArray(record.kpis) || !("avg_ms" in kpis)) return null;
  const response = timeseriesOf(record.response_time, "response_time");
  const throughput = timeseriesOf(record.throughput, "throughput", "requests");
  const resources = asRecord(record.resources);
  const cpu = timeseriesOf(resources?.cpu, "cpu");
  const memory = timeseriesOf(resources?.memory, "memory");
  const services = Array.isArray(record.services) ? record.services : [];
  const endpoints = Array.isArray(record.slow_endpoints) ? record.slow_endpoints : [];
  const incidents = Array.isArray(record.incidents) ? record.incidents : [];
  const adaptedServices: ServiceSummary[] = services.flatMap((item) => {
    const service = asRecord(item);
    if (!service || typeof service.name !== "string") return [];
    const health = service.health === "critical" || service.health === "degraded" ? service.health : "healthy";
    return [
      {
        name: service.name,
        description: "",
        health: health as Health,
        latencyMs: num(service.avg_ms),
        rpm: num(service.rpm),
        errorRate: num(service.error_pct),
        instances: num(service.instances),
        version: "",
        language: "",
        spark: [],
      },
    ];
  });
  const slowEndpoints: EndpointRow[] = endpoints.flatMap((item) => {
    const row = asRecord(item);
    if (!row || typeof row.route !== "string" || typeof row.method !== "string") return [];
    return [
      {
        key: typeof row.key === "string" ? row.key : `${row.method} ${row.route}`,
        method: row.method,
        route: row.route,
        service: typeof row.service === "string" ? row.service : "",
        calls: num(row.calls),
        avgMs: num(row.avg_ms),
        p95Ms: num(row.p95_ms),
        p99Ms: num(row.p99_ms),
        errorRate: num(row.error_pct),
        apdex: num(row.apdex),
        trend: [],
      },
    ];
  });
  const adaptedIncidents: Incident[] = incidents.flatMap((item) => {
    const incident = asRecord(item);
    if (!incident || typeof incident.id !== "string" || typeof incident.title !== "string") return [];
    const started = typeof incident.started_at === "string" ? Date.parse(incident.started_at) : num(incident.started_at);
    const status: IncidentStatus =
      incident.status === "acknowledged" || incident.status === "resolved" ? incident.status : "firing";
    const severity: Severity = incident.severity === "warning" || incident.severity === "info" ? incident.severity : "critical";
    return [
      {
        id: incident.id,
        title: incident.title,
        detail: typeof incident.detail === "string" ? incident.detail : "",
        severity,
        status,
        service: typeof incident.rule_name === "string" ? incident.rule_name : "shop-api",
        startedAt: Number.isFinite(started) ? started : Date.now(),
        project: typeof record.slug === "string" ? record.slug : "shop-api",
        env: incident.environment === "staging" || incident.environment === "dev" ? incident.environment : "prod",
      },
    ];
  });
  const overview: Overview = {
    empty: adaptedServices.length === 0 && num(asRecord(kpis.avg_ms)?.value) === 0,
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
    slowEndpoints,
    services: adaptedServices,
    incidents: adaptedIncidents,
    insights: adaptedIncidents.slice(0, 3).map((incident) => ({
      id: incident.id,
      severity: incident.severity,
      title: incident.title,
      body: incident.detail,
      href: "/alerts",
    })),
  };
  return overview;
}

function projectId(slug: string) {
  return projectBySlug(slug).id;
}

export const api = {
  async login(email: string, password: string): Promise<SessionUser> {
    const up = await probeApi();
    if (up) {
      try {
        const response = await fetch(`${apiBase()}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (response.status === 401 || response.status === 403) {
          throw new Error("Those credentials were rejected.");
        }
        if (response.ok) {
          const body = (await response.json()) as {
            access_token?: string;
            token?: string;
            user?: { email?: string; name?: string };
          };
          const token = body.access_token || body.token;
          if (token) {
            return {
              token,
              email: body.user?.email || email,
              name: body.user?.name || email.split("@")[0] || "Operator",
            };
          }
        }
      } catch (error) {
        if (error instanceof Error && error.message === "Those credentials were rejected.") throw error;
      }
    }
    if (email.trim().toLowerCase() === DEMO_EMAIL && password === DEMO_PASSWORD) {
      return { token: "demo.pulseops.token", email: DEMO_EMAIL, name: "Demo Operator" };
    }
    throw new Error("Use demo@pulseops.dev and pulseops-demo while the API is offline.");
  },

  async projects(chaos = false): Promise<Project[]> {
    if (chaos) throw new Error("The project list timed out.");
    const remote = await tryGet("/projects");
    if (isArrayOf(remote, (item): item is Project => !!item && typeof item === "object" && "slug" in item)) {
      mark("api");
      return remote;
    }
    mark("mock");
    return PROJECTS;
  },

  async overview(scope: Scope) {
    if (scope.chaos) {
      await pause(280);
      throw new Error("The metrics query timed out before the rollup came back.");
    }
    const remote = await tryGet(`/projects/${encodeURIComponent(scope.project)}/overview?${query(scope)}`);
    const adapted = isOverview(remote) ? remote : adaptLiveOverview(remote);
    if (adapted) {
      mark("api");
      return adapted;
    }
    mark("mock");
    await pause();
    return mockOverview(scope.project, scope.env, scope.range);
  },

  services(scope: Scope) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/services?${query(scope)}`,
      () => mockServices(scope.project, scope.env, scope.range),
      (value): value is ServiceSummary[] => isArrayOf(value, isService),
    );
  },

  service(scope: Scope, name: string) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/services/${encodeURIComponent(name)}?${query(scope)}`,
      () => mockService(scope.project, scope.env, scope.range, name),
      (value): value is ServiceDetail | null => value === null || isServiceDetail(value),
    );
  },

  endpoints(scope: Scope) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/endpoints?${query(scope)}`,
      () => mockEndpoints(scope.project, scope.env, scope.range),
      (value): value is EndpointRow[] => isArrayOf(value, isEndpoint),
    );
  },

  endpoint(scope: Scope, key: string) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/endpoints/${encodeURIComponent(key)}?${query(scope)}`,
      () => mockEndpoint(scope.project, scope.env, scope.range, key),
      (value): value is EndpointDetail | null => value === null || isDetail(value),
    );
  },

  resources(scope: Scope) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/resources?${query(scope)}`,
      () => mockResources(scope.project, scope.env, scope.range),
      isResources,
    );
  },

  errors(scope: Scope) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/errors?env=${scope.env}`,
      () => mockErrors(scope.project, scope.env),
      (value): value is ErrorGroup[] => isArrayOf(value, isError),
    );
  },

  error(scope: Scope, fingerprint: string) {
    return load(
      scope,
      `/projects/${projectId(scope.project)}/errors/${encodeURIComponent(fingerprint)}?env=${scope.env}`,
      () => mockError(scope.project, scope.env, fingerprint),
      (value): value is ErrorDetail | null => value === null || isErrorDetail(value),
    );
  },

  async rules(scope: Scope) {
    const data = await load(
      scope,
      `/projects/${projectId(scope.project)}/alert-rules`,
      () => mockRules(scope.project),
      (value): value is AlertRule[] => isArrayOf(value, isRule),
    );
    return mergeRules(scope.project, data);
  },

  async incidents(scope: Scope) {
    const data = await load(
      scope,
      `/incidents?project_id=${projectId(scope.project)}&env=${scope.env}`,
      () => mockIncidents(scope.project, scope.env),
      (value): value is Incident[] => isArrayOf(value, isIncident),
    );
    return mergeIncidents(data);
  },

  async settings(scope: Scope) {
    const data = await load(
      scope,
      `/projects/${projectId(scope.project)}`,
      () => mockSettings(scope.project),
      (value): value is SettingsPayload => !!value && typeof value === "object" && "apiKey" in value && "team" in value,
    );
    return { ...data, apiKey: currentKey(scope.project, data.apiKey) };
  },

  async ack(id: string) {
    await trySend(`/incidents/${id}/ack`, "POST");
    ackIncident(id);
  },

  async toggleRule(project: string, id: string, enabled: boolean) {
    await trySend(`/projects/${projectId(project)}/alert-rules/${id}`, "PATCH", { enabled });
    setRuleEnabled(id, enabled);
  },

  async createRule(project: string, input: RuleInput) {
    await trySend(`/projects/${projectId(project)}/alert-rules`, "POST", input);
    return addRule(project, input);
  },

  rotate(project: string) {
    return rotateKey(project);
  },
};

export function wsUrl(projectIdValue: string, token: string) {
  const base = apiBase().replace(/^http/, "ws");
  const params = new URLSearchParams({ project_id: projectIdValue, token });
  return `${base}/ws?${params.toString()}`;
}
