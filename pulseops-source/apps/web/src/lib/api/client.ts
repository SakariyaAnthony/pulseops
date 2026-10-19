import {
  adaptEndpointDetail,
  adaptEndpointRows,
  adaptErrorDetail,
  adaptErrors,
  adaptIncidents,
  adaptInsights,
  adaptLiveOverview,
  adaptProjects,
  adaptResources,
  adaptRule,
  adaptRules,
  adaptServiceDetail,
  adaptServices,
  adaptSettings,
} from "@/lib/api/adapt";
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
  PROJECTS,
} from "@/lib/api/mock";
import type {
  InsightPreview,
  Overview,
  Project,
  ResourcesPayload,
  RuleInput,
  Scope,
  SessionUser,
  SettingsPayload,
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

type SendResult = { state: "ok"; body: unknown } | { state: "down" } | { state: "error" };

async function trySend(path: string, method: string, body?: unknown): Promise<SendResult> {
  if (!(await probeApi())) return { state: "down" };
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
    if (!response.ok) return { state: "error" };
    if (response.status === 204) return { state: "ok", body: null };
    const textBody = await response.text();
    if (!textBody) return { state: "ok", body: null };
    return { state: "ok", body: JSON.parse(textBody) as unknown };
  } catch {
    return { state: "error" };
  }
}

function projectPath(project: string, suffix = "") {
  return `/projects/${encodeURIComponent(project)}${suffix}`;
}

function emptySeries(metric: string) {
  return { metric, resolution: "1m", series: [], deploys: [] };
}

function emptyOverview(): Overview {
  return {
    empty: true,
    kpis: [],
    responseTime: emptySeries("response_time"),
    throughput: emptySeries("throughput"),
    cpuMemory: emptySeries("resources"),
    slowEndpoints: [],
    services: [],
    incidents: [],
    insights: [],
  };
}

function emptyResources(): ResourcesPayload {
  return {
    empty: true,
    hosts: [],
    aggregate: {
      cpu: emptySeries("cpu"),
      memory: emptySeries("memory"),
      disk: emptySeries("disk"),
      network: emptySeries("network"),
      lag: emptySeries("lag"),
    },
    byHost: {},
    heatmap: { hosts: [], times: [], values: [] },
  };
}

function isOverview(value: unknown): value is Overview {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Overview>;
  return Array.isArray(record.kpis) && !!record.responseTime && Array.isArray(record.responseTime.series);
}

function blankSettings(slug: string): SettingsPayload {
  return {
    project: { id: slug, name: slug, slug },
    environments: [],
    apiKey: "",
    team: [],
    channels: [],
    retention: [],
  };
}

function query(scope: Scope) {
  return new URLSearchParams({ range: scope.range, env: scope.env }).toString();
}

async function offline<T>(scope: Scope, fallback: () => T): Promise<T | undefined> {
  if (scope.chaos) {
    await pause(280);
    throw new Error("The metrics query timed out before the rollup came back.");
  }
  if (await probeApi()) return undefined;
  mark("mock");
  await pause();
  return fallback();
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
    if (!(await probeApi())) {
      mark("mock");
      return PROJECTS;
    }
    const remote = await tryGet("/projects");
    mark("api");
    return adaptProjects(remote) ?? [];
  },

  async overview(scope: Scope) {
    const mocked = await offline(scope, () => mockOverview(scope.project, scope.env, scope.range));
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/overview")}?${query(scope)}`);
    const adapted = isOverview(remote) ? remote : adaptLiveOverview(remote);
    mark("api");
    return adapted ?? emptyOverview();
  },

  async services(scope: Scope) {
    const mocked = await offline(scope, () => mockServices(scope.project, scope.env, scope.range));
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/services")}?${query(scope)}`);
    mark("api");
    return adaptServices(remote);
  },

  async service(scope: Scope, name: string) {
    const mocked = await offline(scope, () => mockService(scope.project, scope.env, scope.range, name));
    if (mocked !== undefined) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, `/services/${encodeURIComponent(name)}`)}?${query(scope)}`);
    mark("api");
    return adaptServiceDetail(remote);
  },

  async endpoints(scope: Scope) {
    const mocked = await offline(scope, () => mockEndpoints(scope.project, scope.env, scope.range));
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/endpoints")}?${query(scope)}&limit=200`);
    mark("api");
    return adaptEndpointRows(remote);
  },

  async endpoint(scope: Scope, key: string) {
    const mocked = await offline(scope, () => mockEndpoint(scope.project, scope.env, scope.range, key));
    if (mocked !== undefined) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, `/endpoints/${encodeURIComponent(key)}`)}?${query(scope)}`);
    mark("api");
    return adaptEndpointDetail(remote);
  },

  async resources(scope: Scope) {
    const mocked = await offline(scope, () => mockResources(scope.project, scope.env, scope.range));
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/resources")}?${query(scope)}`);
    mark("api");
    return adaptResources(remote) ?? emptyResources();
  },

  async errors(scope: Scope) {
    const mocked = await offline(scope, () => mockErrors(scope.project, scope.env));
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/errors")}?${query(scope)}`);
    mark("api");
    return adaptErrors(remote) ?? [];
  },

  async error(scope: Scope, fingerprint: string) {
    const mocked = await offline(scope, () => mockError(scope.project, scope.env, fingerprint));
    if (mocked !== undefined) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, `/errors/${encodeURIComponent(fingerprint)}`)}?${query(scope)}`);
    mark("api");
    return adaptErrorDetail(remote);
  },

  async rules(scope: Scope) {
    const mocked = await offline(scope, () => mockRules(scope.project));
    if (mocked) return mergeRules(scope.project, mocked);
    const remote = await tryGet(projectPath(scope.project, "/alert-rules"));
    mark("api");
    return mergeRules(scope.project, adaptRules(remote, scope.project) ?? []);
  },

  async incidents(scope: Scope) {
    const mocked = await offline(scope, () => mockIncidents(scope.project, scope.env));
    if (mocked) return mergeIncidents(mocked);
    const remote = await tryGet(`/incidents?project_id=${encodeURIComponent(scope.project)}&env=${scope.env}`);
    mark("api");
    return mergeIncidents(adaptIncidents(remote, scope.project, scope.env));
  },

  async insights(scope: Scope): Promise<InsightPreview[]> {
    const mocked = await offline(scope, () => mockOverview(scope.project, scope.env, scope.range).insights);
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/insights")}?${query(scope)}`);
    mark("api");
    return adaptInsights(remote) ?? [];
  },

  async settings(scope: Scope) {
    const mocked = await offline(scope, () => mockSettings(scope.project));
    if (mocked) return { ...mocked, apiKey: currentKey(scope.project, mocked.apiKey) };
    const remote = await tryGet(projectPath(scope.project));
    mark("api");
    const settings = adaptSettings(remote, scope.project) ?? blankSettings(scope.project);
    return { ...settings, apiKey: currentKey(scope.project, settings.apiKey) };
  },

  async ack(id: string) {
    const result = await trySend(`/incidents/${id}/ack`, "POST");
    if (result.state === "down") ackIncident(id);
    if (result.state === "error") throw new Error("Couldn’t acknowledge the incident");
  },

  async toggleRule(project: string, id: string, enabled: boolean) {
    const result = await trySend(projectPath(project, `/alert-rules/${id}`), "PATCH", { enabled });
    if (result.state === "down") setRuleEnabled(id, enabled);
    if (result.state === "error") throw new Error("Couldn’t update the rule");
  },

  async createRule(project: string, input: RuleInput) {
    const result = await trySend(projectPath(project, "/alert-rules"), "POST", {
      ...input,
      operator: input.operator === "below" ? "lt" : "gt",
      enabled: true,
    });
    if (result.state === "down") return addRule(project, input);
    if (result.state === "error") throw new Error("Couldn’t create the rule");
    return (
      adaptRule(result.body, project) ?? {
        id: "created",
        project,
        ...input,
        enabled: true,
      }
    );
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
