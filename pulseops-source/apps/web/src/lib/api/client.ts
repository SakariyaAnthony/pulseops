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
  adaptScan,
  adaptScanApis,
  adaptScanAssets,
  adaptScanPages,
  adaptScans,
  adaptServiceDetail,
  adaptServices,
  adaptSettings,
  emptyScan,
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
  AssetSummary,
  ScanAssetRow,
  ScanEndpoint,
  ScanPage,
  ScanRequest,
  ScanRun,
  ScanSetup,
  Scope,
  SessionUser,
  SettingsPayload,
} from "@/lib/api/types";
import {
  adaptVitalsDetail,
  adaptVitalsLab,
  adaptVitalsRoutes,
  adaptVitalsSummary,
  mockDetail,
  mockLab,
  mockRoutes,
  mockSummary,
  type VitalFilters,
} from "@/lib/api/vitals";
import {
  adaptUser,
  adaptUsersPage,
  mockUpdateUser,
  mockUsersPage,
  type UserFilters,
  type UserRole,
  type UserRow,
  type UsersPage,
} from "@/lib/api/users";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";

const DEMO_EMAIL = "demo@pulseops.dev";
const DEMO_PASSWORD = "pulseops-demo";

const LOCAL_API = "http://127.0.0.1:47322";

/** The address a separate app (not this dashboard) posts telemetry to. Always the real API, never the dev proxy. */
export function ingestUrl(): string {
  return (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") || LOCAL_API;
}

export function apiBase(): string {
  const configured = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
  if (import.meta.env.DEV && (configured === "" || configured === LOCAL_API))
    return "/api";
  return configured || LOCAL_API;
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

type SendResult =
  { state: "ok"; body: unknown } | { state: "down" } | { state: "error" };

async function sendJson(
  path: string,
  method: string,
  body?: unknown,
): Promise<unknown> {
  if (!(await probeApi())) throw new Error("API is down");
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const textBody = await response.text();
  const parsed = textBody ? (JSON.parse(textBody) as unknown) : null;
  if (!response.ok) {
    const record =
      parsed && typeof parsed === "object"
        ? (parsed as { detail?: unknown })
        : null;
    const detail = record?.detail;
    throw new Error(typeof detail === "string" ? detail : "Request failed");
  }
  return parsed;
}

async function trySend(
  path: string,
  method: string,
  body?: unknown,
): Promise<SendResult> {
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

function scanConfigBody(scan: ScanSetup) {
  return {
    repository_path: scan.repositoryPath || null,
    base_url: scan.baseUrl || null,
    routes: scan.routes,
    viewport: { width: scan.viewportWidth, height: scan.viewportHeight },
    timeout_ms: scan.timeoutMs,
    start_command: scan.startCommand || null,
  };
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
  return (
    Array.isArray(record.kpis) &&
    !!record.responseTime &&
    Array.isArray(record.responseTime.series)
  );
}

function blankSettings(slug: string): SettingsPayload {
  return {
    project: { id: slug, name: slug, slug },
    environments: [],
    apiKey: "",
    team: [],
    channels: [],
    retention: [],
    scan: emptyScan(),
  };
}

function query(scope: Scope) {
  return new URLSearchParams({ range: scope.range, env: scope.env }).toString();
}

function vitalsQuery(scope: Scope, filters: VitalFilters, extra?: Record<string, string>) {
  const params = new URLSearchParams({ range: scope.range, env: scope.env, ...extra });
  if (filters.device !== "all") params.set("device", filters.device);
  if (filters.nav !== "all") params.set("nav_type", filters.nav);
  return params.toString();
}

async function offline<T>(
  scope: Scope,
  fallback: () => T,
): Promise<T | undefined> {
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
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
        if (response.status === 403) {
          // A disabled account gets its own message from the API.
          const detail = (await response.json().catch(() => null)) as {
            detail?: unknown;
          } | null;
          throw new Error(
            typeof detail?.detail === "string"
              ? detail.detail
              : "Those credentials were rejected.",
          );
        }
        if (response.status === 401) {
          throw new Error("Those credentials were rejected.");
        }
        if (response.ok) {
          const body = (await response.json()) as {
            access_token?: string;
            token?: string;
            user?: { email?: string; name?: string; role?: string };
          };
          const token = body.access_token || body.token;
          if (token) {
            return {
              token,
              email: body.user?.email || email,
              name: body.user?.name || email.split("@")[0] || "Operator",
              role: body.user?.role === "admin" ? "admin" : "member",
            };
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message === "Those credentials were rejected." ||
            error.message.startsWith("This account is disabled"))
        )
          throw error;
      }
    }
    if (
      email.trim().toLowerCase() === DEMO_EMAIL &&
      password === DEMO_PASSWORD
    ) {
      return {
        token: "demo.pulseops.token",
        email: DEMO_EMAIL,
        name: "Demo Operator",
        role: "admin",
      };
    }
    throw new Error(
      "Use demo@pulseops.dev and pulseops-demo while the API is offline.",
    );
  },

  /** Creates an account and signs it in. Needs the API: there is nowhere to keep an account offline. */
  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<SessionUser> {
    if (!(await probeApi()))
      throw new Error("The API is not running, so an account cannot be created.");
    const body = (await sendJson("/auth/register", "POST", {
      name,
      email,
      password,
    })) as {
      access_token?: string;
      user?: { email?: string; name?: string; role?: string };
    } | null;
    if (!body?.access_token) throw new Error("Sign-up did not return a session.");
    return {
      token: body.access_token,
      email: body.user?.email || email.trim().toLowerCase(),
      name: body.user?.name || name,
      role: body.user?.role === "admin" ? "admin" : "member",
    };
  },

  /** Full profile for the Profile page. Offline it is built from the saved session. */
  async profile(): Promise<UserRow> {
    if (!(await probeApi())) {
      const session = useSession.getState();
      return {
        id: "local",
        email: session.email ?? "",
        name: session.name ?? "Operator",
        role: session.role ?? "member",
        isActive: true,
        createdAt: "",
        lastLoginAt: new Date().toISOString(),
        projectCount: 0,
      };
    }
    const user = adaptUser(await sendJson("/auth/me", "GET"));
    if (!user) throw new Error("The profile could not be loaded.");
    return user;
  },

  async updateProfile(name: string): Promise<UserRow> {
    if (!(await probeApi()))
      throw new Error("The API is not running, so the profile cannot be saved.");
    const user = adaptUser(await sendJson("/auth/me", "PATCH", { name }));
    if (!user) throw new Error("The profile could not be saved.");
    return user;
  },

  async changePassword(current: string, next: string): Promise<void> {
    if (!(await probeApi()))
      throw new Error("The API is not running, so the password cannot be changed.");
    await sendJson("/auth/password", "POST", {
      current_password: current,
      new_password: next,
    });
  },

  /** The signed-in account as the API sees it. Null when the API is down. */
  async me(): Promise<Omit<SessionUser, "token"> | null> {
    if (!(await probeApi())) return null;
    const user = adaptUser(await sendJson("/auth/me", "GET"));
    return user ? { email: user.email, name: user.name, role: user.role } : null;
  },

  async users(filters: UserFilters): Promise<UsersPage> {
    if (!(await probeApi())) {
      mark("mock");
      await pause();
      return mockUsersPage(filters);
    }
    const params = new URLSearchParams({ limit: "200" });
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.role !== "all") params.set("role", filters.role);
    if (filters.status !== "all") params.set("status", filters.status);
    mark("api");
    return adaptUsersPage(await sendJson(`/users?${params.toString()}`, "GET"));
  },

  async updateUser(
    id: string,
    patch: { role?: UserRole; isActive?: boolean },
  ): Promise<UserRow> {
    if (!(await probeApi())) return mockUpdateUser(id, patch);
    const body: Record<string, unknown> = {};
    if (patch.role) body.role = patch.role;
    if (patch.isActive !== undefined) body.is_active = patch.isActive;
    const updated = adaptUser(
      await sendJson(`/users/${encodeURIComponent(id)}`, "PATCH", body),
    );
    if (!updated) throw new Error("The user could not be updated.");
    return updated;
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
    const mocked = await offline(scope, () =>
      mockOverview(scope.project, scope.env, scope.range),
    );
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/overview")}?${query(scope)}`,
    );
    const adapted = isOverview(remote) ? remote : adaptLiveOverview(remote);
    mark("api");
    return adapted ?? emptyOverview();
  },

  async services(scope: Scope) {
    const mocked = await offline(scope, () =>
      mockServices(scope.project, scope.env, scope.range),
    );
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/services")}?${query(scope)}`,
    );
    mark("api");
    return adaptServices(remote);
  },

  async service(scope: Scope, name: string) {
    const mocked = await offline(scope, () =>
      mockService(scope.project, scope.env, scope.range, name),
    );
    if (mocked !== undefined) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, `/services/${encodeURIComponent(name)}`)}?${query(scope)}`,
    );
    mark("api");
    return adaptServiceDetail(remote);
  },

  async endpoints(scope: Scope) {
    const mocked = await offline(scope, () =>
      mockEndpoints(scope.project, scope.env, scope.range),
    );
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/endpoints")}?${query(scope)}&limit=200`,
    );
    mark("api");
    return adaptEndpointRows(remote);
  },

  async endpoint(scope: Scope, key: string) {
    const mocked = await offline(scope, () =>
      mockEndpoint(scope.project, scope.env, scope.range, key),
    );
    if (mocked !== undefined) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, `/endpoints/${encodeURIComponent(key)}`)}?${query(scope)}`,
    );
    mark("api");
    return adaptEndpointDetail(remote);
  },

  async resources(scope: Scope) {
    const mocked = await offline(scope, () =>
      mockResources(scope.project, scope.env, scope.range),
    );
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/resources")}?${query(scope)}`,
    );
    mark("api");
    return adaptResources(remote) ?? emptyResources();
  },

  async errors(scope: Scope) {
    const mocked = await offline(scope, () =>
      mockErrors(scope.project, scope.env),
    );
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/errors")}?${query(scope)}`,
    );
    mark("api");
    return adaptErrors(remote) ?? [];
  },

  async error(scope: Scope, fingerprint: string) {
    const mocked = await offline(scope, () =>
      mockError(scope.project, scope.env, fingerprint),
    );
    if (mocked !== undefined) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, `/errors/${encodeURIComponent(fingerprint)}`)}?${query(scope)}`,
    );
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
    const mocked = await offline(scope, () =>
      mockIncidents(scope.project, scope.env),
    );
    if (mocked) return mergeIncidents(mocked);
    const remote = await tryGet(
      `/incidents?project_id=${encodeURIComponent(scope.project)}&env=${scope.env}`,
    );
    mark("api");
    return mergeIncidents(adaptIncidents(remote, scope.project, scope.env));
  },

  async insights(scope: Scope): Promise<InsightPreview[]> {
    const mocked = await offline(
      scope,
      () => mockOverview(scope.project, scope.env, scope.range).insights,
    );
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/insights")}?${query(scope)}`,
    );
    mark("api");
    return adaptInsights(remote) ?? [];
  },

  async settings(scope: Scope) {
    const mocked = await offline(scope, () => mockSettings(scope.project));
    if (mocked)
      return { ...mocked, apiKey: currentKey(scope.project, mocked.apiKey) };
    const remote = await tryGet(projectPath(scope.project));
    mark("api");
    const settings =
      adaptSettings(remote, scope.project) ?? blankSettings(scope.project);
    // Against the real API the key prefix comes from the server. Only the offline demo keeps a local key.
    return settings;
  },

  async ack(id: string) {
    const result = await trySend(`/incidents/${id}/ack`, "POST");
    if (result.state === "down") ackIncident(id);
    if (result.state === "error")
      throw new Error("Couldn’t acknowledge the incident");
  },

  async toggleRule(project: string, id: string, enabled: boolean) {
    const result = await trySend(
      projectPath(project, `/alert-rules/${id}`),
      "PATCH",
      { enabled },
    );
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

  /** Replaces the project's ingest key and returns the new token, which is only ever shown once. */
  async rotate(project: string): Promise<string> {
    if (!(await probeApi())) return rotateKey(project);
    const body = await sendJson(projectPath(project, "/api-key"), "POST");
    const token = (body as { api_key?: { token?: unknown } } | null)?.api_key
      ?.token;
    if (typeof token !== "string") throw new Error("The key was not created");
    return token;
  },

  async scans(project: string): Promise<ScanRun[]> {
    const remote = await tryGet(projectPath(project, "/scans"));
    mark("api");
    return adaptScans(remote);
  },

  async scan(id: string): Promise<ScanRun> {
    const remote = await tryGet(`/scans/${encodeURIComponent(id)}`);
    mark("api");
    const scan = adaptScan(remote);
    if (!scan) throw new Error("Scan not found");
    return scan;
  },

  async scanAssets(
    id: string,
  ): Promise<{ summary: AssetSummary; assets: ScanAssetRow[] }> {
    const remote = await tryGet(
      `/scans/${encodeURIComponent(id)}/assets?limit=500`,
    );
    mark("api");
    return adaptScanAssets(remote);
  },

  async scanApis(
    id: string,
  ): Promise<{ endpoints: ScanEndpoint[]; requests: ScanRequest[] }> {
    const remote = await tryGet(`/scans/${encodeURIComponent(id)}/apis`);
    mark("api");
    return adaptScanApis(remote);
  },

  async scanPages(id: string): Promise<ScanPage[]> {
    const remote = await tryGet(`/scans/${encodeURIComponent(id)}/pages`);
    mark("api");
    return adaptScanPages(remote);
  },

  async vitalsSummary(scope: Scope, filters: VitalFilters) {
    const mocked = await offline(scope, () => mockSummary(filters));
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/vitals/summary")}?${vitalsQuery(scope, filters)}`,
    );
    mark("api");
    return adaptVitalsSummary(remote);
  },

  async vitalsRoutes(scope: Scope, filters: VitalFilters) {
    const mocked = await offline(scope, () => mockRoutes());
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/vitals/routes")}?${vitalsQuery(scope, filters)}`,
    );
    mark("api");
    return adaptVitalsRoutes(remote);
  },

  async vitalsDetail(scope: Scope, route: string, filters: VitalFilters) {
    const mocked = await offline(scope, () => mockDetail(route));
    if (mocked) return mocked;
    const remote = await tryGet(
      `${projectPath(scope.project, "/vitals/detail")}?${vitalsQuery(scope, filters, { route })}`,
    );
    mark("api");
    return adaptVitalsDetail(remote, route);
  },

  async vitalsLab(scope: Scope) {
    const mocked = await offline(scope, () => mockLab());
    if (mocked) return mocked;
    const remote = await tryGet(`${projectPath(scope.project, "/vitals/lab")}`);
    mark("api");
    return adaptVitalsLab(remote);
  },

  saveScanConfig(project: string, scan: ScanSetup) {
    return sendJson(
      projectPath(project, "/scan-config"),
      "PATCH",
      scanConfigBody(scan),
    );
  },

  /** Creates a project with its scan setup in one request. A bad path creates nothing. */
  async createProject(
    name: string,
    scan: ScanSetup,
  ): Promise<{ slug: string; name: string; apiKey: string }> {
    const body = await sendJson("/projects", "POST", {
      name,
      scan_config: scanConfigBody(scan),
    });
    const project =
      (body && typeof body === "object"
        ? (
            body as {
              project?: {
                slug?: unknown;
                name?: unknown;
                repository_path?: unknown;
              };
            }
          ).project
        : null) ?? null;
    if (!project || typeof project.slug !== "string")
      throw new Error("The project was not created");
    // An API started before this feature ignores scan_config. Save the setup separately so it is not lost.
    if (scan.repositoryPath && !project.repository_path) {
      await sendJson(
        projectPath(project.slug, "/scan-config"),
        "PATCH",
        scanConfigBody(scan),
      );
    }
    const key = (body as { api_key?: { token?: unknown } }).api_key?.token;
    return {
      slug: project.slug,
      name: typeof project.name === "string" ? project.name : name,
      apiKey: typeof key === "string" ? key : "",
    };
  },

  /** Permanently removes a project and everything stored for it. */
  async deleteProject(project: string): Promise<void> {
    await sendJson(projectPath(project), "DELETE");
  },

  startScan(project: string, mode: "static" | "browser" | "full" | "vitals") {
    return sendJson(projectPath(project, "/scans"), "POST", { mode }).then(
      (body) => adaptScan(body),
    );
  },

  cancelScan(id: string) {
    return sendJson(`/scans/${encodeURIComponent(id)}/cancel`, "POST");
  },
};

export function wsUrl(projectIdValue: string, token: string) {
  const base = apiBase();
  const params = new URLSearchParams({ project_id: projectIdValue, token });
  const socketBase = base.startsWith("/")
    ? `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}${base}`
    : base.replace(/^http/, "ws");
  return `${socketBase}/ws?${params.toString()}`;
}
