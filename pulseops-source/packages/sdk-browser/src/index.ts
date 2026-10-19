export type PulseOpsOptions = {
  url: string;
  apiKey: string;
  service: string;
  env?: string;
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
    }).catch(() => undefined);
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
  };

  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const initial = navigation && navigation.duration > 0 ? navigation.duration : performance.now();
  pushRequest("GET", pageRoute(), 200, initial);

  const measurePaint = () => {
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
    if (document.visibilityState === "hidden") flush(true);
  });
}
