import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";

export type PulseOpsOptions = {
  url: string;
  apiKey: string;
  service: string;
  env?: string;
  /** Set to false to skip Core Web Vitals and page load collection. Default true. */
  vitals?: boolean;
  /** Share of page views that report vitals, from 0 to 1. Default 1. */
  sampleRate?: number;
};

type VitalName = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
type NavType = "first_load" | "spa_navigation";
type Device = "mobile" | "tablet" | "desktop";

type VitalPoint = {
  env: string;
  service: string;
  route: string;
  nav_type: NavType;
  device: Device;
  metric: VitalName;
  value: number;
  page_view_id: string;
  connection?: string;
};

type LoadPoint = {
  env: string;
  service: string;
  route: string;
  nav_type: NavType;
  device: Device;
  ttfb_ms?: number;
  dom_content_loaded_ms?: number;
  load_ms?: number;
  transfer_bytes?: number;
  resource_count?: number;
  js_bytes?: number;
  long_task_count?: number;
  long_task_ms?: number;
  tbt_ms?: number;
  page_view_id: string;
};

type RequestPoint = {
  env: string;
  service: string;
  method: string;
  route: string;
  status_code: number;
  duration_ms: number;
};

type ErrorPoint = {
  env: string;
  service: string;
  fingerprint: string;
  type: string;
  message: string;
  stack: string;
  route: string;
};

export function startPulseOps(options: PulseOpsOptions): void {
  if (typeof window === "undefined") return;
  const endpoint = options.url.replace(/\/$/, "");
  const env = options.env || "dev";
  const service = options.service;
  const requests: RequestPoint[] = [];
  const errors: ErrorPoint[] = [];
  const loads: LoadPoint[] = [];
  // Latest unsent value per metric. A metric that is reported again before the next flush replaces the earlier one.
  const pendingVitals = new Map<VitalName, VitalPoint>();
  const originalFetch = window.fetch.bind(window);

  const pageRoute = () => `page:${window.location.pathname || "/"}`;

  const pathOf = (raw: string) => {
    try {
      return new URL(raw, window.location.href).pathname || "/";
    } catch {
      return raw.split("?")[0] || "/";
    }
  };

  const ownCall = (raw: string) => {
    try {
      return new URL(raw, window.location.href).href.startsWith(endpoint);
    } catch {
      return false;
    }
  };

  const pushRequest = (method: string, route: string, status: number, duration: number) => {
    requests.push({
      env,
      service,
      method: method.toUpperCase(),
      route,
      status_code: status >= 100 && status <= 599 ? status : 599,
      duration_ms: Math.max(0, duration),
    });
  };

  const fingerprint = (name: string, stack: string) => {
    const frame = stack.split("\n").map((line) => line.trim()).find((line) => line.startsWith("at ")) ?? "";
    const raw = `${name}:${frame}`;
    let hash = 0;
    for (let index = 0; index < raw.length; index += 1) {
      hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
    }
    return `js_${hash.toString(16)}`;
  };

  const pushError = (name: string, message: string, stack: string) => {
    errors.push({
      env,
      service,
      fingerprint: fingerprint(name, stack),
      type: name || "Error",
      message: message.slice(0, 2000),
      stack: stack.slice(0, 20000),
      route: pageRoute(),
    });
  };

  const post = (path: string, body: unknown, keepalive = false) => {
    originalFetch(`${endpoint}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": options.apiKey,
      },
      body: JSON.stringify(body),
      keepalive,
    })
      .then((response) => {
        if (!response.ok) console.warn(`[PulseOps] ${path} was rejected with status ${response.status}. Check the API key and env.`);
      })
      .catch(() => console.warn(`[PulseOps] could not reach ${endpoint}. Is the API running?`));
  };

  const flush = (keepalive = false) => {
    if (requests.length) {
      const batch = requests.splice(0, requests.length);
      post("/ingest/v1/metrics", { requests: batch }, keepalive);
    }
    if (errors.length) {
      const batch = errors.splice(0, errors.length);
      post("/ingest/v1/errors", { errors: batch }, keepalive);
    }
    if (pendingVitals.size || loads.length) {
      const vitals = Array.from(pendingVitals.values());
      pendingVitals.clear();
      post("/ingest/v1/vitals", { vitals, loads: loads.splice(0, loads.length) }, keepalive);
    }
  };

  // ---- Core Web Vitals and page loads (field data, one page view at a time) ----
  const collectVitals = options.vitals !== false;
  const sampled = collectVitals && Math.random() < (options.sampleRate ?? 1);
  const pageViewId = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  const landingRoute = window.location.pathname || "/";
  // Routes the visitor moved through, so INP and CLS can be tied to the route where they happened.
  const timeline: { route: string; at: number }[] = [{ route: landingRoute, at: 0 }];
  const routeAt = (time: number) => {
    let route = timeline[0].route;
    for (const entry of timeline) if (entry.at <= time) route = entry.route;
    return route;
  };
  const deviceClass = (): Device => {
    const uaMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
    // A phone without a viewport tag reports a 980px layout width, so the physical screen width counts too.
    const width = Math.min(window.innerWidth, window.screen?.width || window.innerWidth);
    if (uaMobile || width < 768) return "mobile";
    return width < 1024 ? "tablet" : "desktop";
  };
  const connectionType = () => (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType;

  const longTasks: { startTime: number; duration: number }[] = [];
  if (sampled && typeof PerformanceObserver !== "undefined") {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long Tasks API is not available in this browser.
    }
  }
  const blocking = (from: number, to: number) => {
    const inside = longTasks.filter((task) => task.startTime >= from && task.startTime <= to);
    return {
      count: inside.length,
      total: inside.reduce((sum, task) => sum + task.duration, 0),
      tbt: inside.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0),
    };
  };
  const resourceStats = (from: number, to: number) => {
    const entries = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
      (entry) => entry.startTime >= from && entry.startTime <= to,
    );
    return {
      count: entries.length,
      bytes: entries.reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
      js: entries
        .filter((entry) => entry.initiatorType === "script" || /\.m?js(\?|$)/.test(entry.name))
        .reduce((sum, entry) => sum + (entry.transferSize || 0), 0),
    };
  };

  const reportVital = (metric: { name: string; value: number; attribution?: unknown }) => {
    if (!sampled) return;
    const name = metric.name as VitalName;
    const attribution = (metric.attribution || {}) as { interactionTime?: number; largestShiftTime?: number };
    // LCP, FCP and TTFB belong to the landing route. INP and CLS belong to the route active when they happened.
    let route = landingRoute;
    if (name === "INP" && typeof attribution.interactionTime === "number") route = routeAt(attribution.interactionTime);
    if (name === "CLS" && typeof attribution.largestShiftTime === "number") route = routeAt(attribution.largestShiftTime);
    pendingVitals.set(name, {
      env,
      service,
      route,
      nav_type: route === landingRoute ? "first_load" : "spa_navigation",
      device: deviceClass(),
      metric: name,
      value: metric.value,
      page_view_id: pageViewId,
      connection: connectionType(),
    });
  };
  if (sampled) {
    onLCP(reportVital);
    onFCP(reportVital);
    onTTFB(reportVital);
    onINP(reportVital);
    onCLS(reportVital);
  }

  let hardLoadSent = false;
  const sendHardLoad = () => {
    if (hardLoadSent || !sampled) return;
    hardLoadSent = true;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const end = Math.max(performance.now(), 1);
    const resources = resourceStats(0, end);
    const fcp = (performance.getEntriesByName("first-contentful-paint")[0] as PerformanceEntry | undefined)?.startTime ?? 0;
    const tasks = blocking(fcp, Math.min(end, 10000));
    loads.push({
      env,
      service,
      route: landingRoute,
      nav_type: "first_load",
      device: deviceClass(),
      ttfb_ms: nav && nav.responseStart > 0 ? nav.responseStart : undefined,
      dom_content_loaded_ms: nav && nav.domContentLoadedEventEnd > 0 ? nav.domContentLoadedEventEnd : undefined,
      load_ms: nav && nav.loadEventEnd > 0 ? nav.loadEventEnd : undefined,
      transfer_bytes: (nav?.transferSize || 0) + resources.bytes,
      resource_count: resources.count + 1,
      js_bytes: resources.js,
      long_task_count: tasks.count,
      long_task_ms: tasks.total,
      tbt_ms: tasks.tbt,
      page_view_id: pageViewId,
    });
  };
  if (sampled) {
    const schedule = () => window.setTimeout(sendHardLoad, 3000);
    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
  }

  const noteRoute = () => {
    const route = window.location.pathname || "/";
    const last = timeline[timeline.length - 1];
    if (last.route === route) return;
    const started = performance.now();
    timeline.push({ route, at: started });
    if (!sampled) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const loadMs = performance.now() - started;
        // Give the new screen a second to fetch its data before counting what it loaded.
        window.setTimeout(() => {
          const resources = resourceStats(started, started + 1000);
          const tasks = blocking(started, started + 1000);
          loads.push({
            env,
            service,
            route,
            nav_type: "spa_navigation",
            device: deviceClass(),
            load_ms: loadMs,
            transfer_bytes: resources.bytes,
            resource_count: resources.count,
            js_bytes: resources.js,
            long_task_count: tasks.count,
            long_task_ms: tasks.total,
            tbt_ms: tasks.tbt,
            page_view_id: pageViewId,
          });
        }, 1000);
      });
    });
  };

  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const initial = navigation && navigation.duration > 0 ? navigation.duration : performance.now();
  pushRequest("GET", pageRoute(), 200, initial);

  const measurePaint = () => {
    noteRoute();
    const path = window.location.pathname || "/";
    const origin = performance.now();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pushRequest("GET", `page:${path}`, 200, performance.now() - origin);
      });
    });
  };

  const pushState = history.pushState.bind(history);
  history.pushState = ((...args: Parameters<History["pushState"]>) => {
    const result = pushState(...args);
    measurePaint();
    return result;
  }) as History["pushState"];

  const replaceState = history.replaceState.bind(history);
  history.replaceState = ((...args: Parameters<History["replaceState"]>) => {
    const result = replaceState(...args);
    measurePaint();
    return result;
  }) as History["replaceState"];

  window.addEventListener("popstate", measurePaint);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const started = performance.now();
    try {
      const response = await originalFetch(input, init);
      if (!ownCall(raw)) pushRequest(method, pathOf(raw), response.status, performance.now() - started);
      return response;
    } catch (error) {
      if (!ownCall(raw)) pushRequest(method, pathOf(raw), 599, performance.now() - started);
      throw error;
    }
  }) as typeof window.fetch;

  const OriginalXHR = window.XMLHttpRequest;
  function WrappedXHR(this: XMLHttpRequest) {
    const xhr = new OriginalXHR();
    let method = "GET";
    let url = "";
    let started = 0;
    const open = xhr.open;
    xhr.open = function (this: XMLHttpRequest, nextMethod: string, nextUrl: string | URL, ...rest: unknown[]) {
      method = String(nextMethod || "GET").toUpperCase();
      url = String(nextUrl);
      return open.apply(this, [nextMethod, nextUrl, ...rest] as unknown as Parameters<XMLHttpRequest["open"]>);
    } as XMLHttpRequest["open"];
    const send = xhr.send;
    xhr.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["send"]>) {
      started = performance.now();
      xhr.addEventListener("loadend", () => {
        if (!ownCall(url)) pushRequest(method, pathOf(url), xhr.status, performance.now() - started);
      });
      return send.apply(this, args);
    };
    return xhr;
  }
  WrappedXHR.prototype = OriginalXHR.prototype;
  window.XMLHttpRequest = WrappedXHR as unknown as typeof XMLHttpRequest;

  window.addEventListener("error", (event) => {
    const error = event.error as { name?: string; message?: string; stack?: string } | undefined;
    const stack = error?.stack || `${event.filename}:${event.lineno}:${event.colno}`;
    pushError(error?.name || "Error", event.message || error?.message || "error", stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { name?: string; message?: string; stack?: string } | undefined;
    const name = reason?.name || "UnhandledRejection";
    const message = reason?.message || String(event.reason);
    pushError(name, message, reason?.stack || "");
  });

  window.setInterval(() => flush(false), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      sendHardLoad();
      flush(true);
    }
  });
}
