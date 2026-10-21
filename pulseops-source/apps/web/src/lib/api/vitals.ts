/**
 * Web Vitals types, adapters and offline sample data.
 *
 * Field data (real users, from the SDK) and lab data (Lighthouse) have separate types on purpose.
 * Nothing here combines the two into one number.
 */
import { asRecord } from "@/lib/api/adapt";
import { hashString, mulberry32 } from "@/lib/api/prng";

export type VitalMetric = "LCP" | "INP" | "CLS" | "FCP" | "TTFB";
export const CORE_VITALS = ["LCP", "INP", "CLS"] as const;
export type CoreVital = (typeof CORE_VITALS)[number];
export type VitalRating = "good" | "needs-improvement" | "poor";

export type DeviceFilter = "all" | "mobile" | "tablet" | "desktop";
export type NavFilter = "all" | "first_load" | "spa_navigation";
export type VitalFilters = { device: DeviceFilter; nav: NavFilter };

export const THRESHOLDS: Record<
  VitalMetric,
  { good: number; poor: number; unit: string }
> = {
  LCP: { good: 2500, poor: 4000, unit: "ms" },
  INP: { good: 200, poor: 500, unit: "ms" },
  CLS: { good: 0.1, poor: 0.25, unit: "" },
  FCP: { good: 1800, poor: 3000, unit: "ms" },
  TTFB: { good: 800, poor: 1800, unit: "ms" },
};

export function rateVital(
  metric: VitalMetric,
  value: number | null,
): VitalRating | null {
  if (value === null || !Number.isFinite(value)) return null;
  const t = THRESHOLDS[metric];
  if (value <= t.good) return "good";
  if (value <= t.poor) return "needs-improvement";
  return "poor";
}

export function formatVital(metric: VitalMetric, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  if (metric === "CLS") return value.toFixed(value < 0.1 ? 3 : 2);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${Math.round(value)} ms`;
}

export type VitalCard = {
  metric: VitalMetric;
  unit: string;
  goodMax: number;
  poorMin: number;
  samples: number;
  p75: number | null;
  rating: VitalRating | null;
  goodPct: number | null;
  improvePct: number | null;
  poorPct: number | null;
};

export type VitalsSummary = {
  metrics: VitalCard[];
  pageViews: number;
  firstLoads: number;
  devices: { mobile: number; tablet: number; desktop: number };
  minSamples: number;
};

export type VitalCell = {
  samples: number;
  p75: number | null;
  rating: VitalRating | null;
};

export type VitalRoute = {
  route: string;
  pageViews: number;
  enoughData: boolean;
  rating: VitalRating | null;
  metrics: Record<VitalMetric, VitalCell>;
  /** Keys: first_load, spa_navigation, mobile, tablet, desktop. Only the core vitals are split. */
  splits: Record<string, Record<CoreVital, VitalCell>>;
};

export type VitalsRoutes = { routes: VitalRoute[]; minSamples: number };

export type Diagnosis = {
  id: string;
  severity: "high" | "medium" | "low";
  title: string;
  evidence: string;
  action: string;
};

export type LabPage = {
  route: string;
  formFactor: "mobile" | "desktop";
  status: string;
  errorSummary: string;
  perfScore: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
  speedIndex: number | null;
  scriptMs: number | null;
  longTaskCount: number | null;
  longTaskTotalMs: number | null;
  transferBytes: number | null;
  resourceCount: number | null;
  resourceSummary: Record<string, { count: number; bytes: number }>;
  diagnosis: Diagnosis[];
};

export type VitalsLab = {
  scan: {
    id: string;
    status: string;
    completedAt: string;
    baseUrl: string;
  } | null;
  pages: LabPage[];
};

export type LoadBreakdown = {
  pageViews: number;
  ttfbMs: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  transferBytes: number | null;
  jsBytes: number | null;
  resourceCount: number | null;
  longTaskCount: number | null;
  longTaskMs: number | null;
  tbtMs: number | null;
};

export type VitalsDetail = {
  route: string;
  field: {
    summary: VitalRoute;
    distribution: {
      metric: CoreVital;
      cap: number;
      bins: {
        from: number;
        to: number;
        count: number;
        rating: VitalRating | null;
      }[];
    }[];
    trend: {
      time: number;
      LCP: number | null;
      INP: number | null;
      CLS: number | null;
    }[];
    load: {
      all: LoadBreakdown;
      first_load: LoadBreakdown;
      spa_navigation: LoadBreakdown;
    };
  };
  lab: VitalsLab;
};

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function ratingOf(value: unknown): VitalRating | null {
  return value === "good" || value === "needs-improvement" || value === "poor"
    ? value
    : null;
}

const ALL_METRICS: VitalMetric[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

function emptyCell(): VitalCell {
  return { samples: 0, p75: null, rating: null };
}

function adaptCell(value: unknown): VitalCell {
  const record = asRecord(value);
  if (!record) return emptyCell();
  return {
    samples: numOrNull(record.samples) ?? 0,
    p75: numOrNull(record.p75),
    rating: ratingOf(record.rating),
  };
}

export function emptySummary(): VitalsSummary {
  return {
    metrics: (["LCP", "INP", "CLS", "FCP", "TTFB"] as VitalMetric[]).map(
      (metric) => ({
        metric,
        unit: THRESHOLDS[metric].unit,
        goodMax: THRESHOLDS[metric].good,
        poorMin: THRESHOLDS[metric].poor,
        samples: 0,
        p75: null,
        rating: null,
        goodPct: null,
        improvePct: null,
        poorPct: null,
      }),
    ),
    pageViews: 0,
    firstLoads: 0,
    devices: { mobile: 0, tablet: 0, desktop: 0 },
    minSamples: 20,
  };
}

export function adaptVitalsSummary(value: unknown): VitalsSummary {
  const record = asRecord(value);
  if (!record || !Array.isArray(record.metrics)) return emptySummary();
  const devices = asRecord(record.devices) ?? {};
  const metrics = record.metrics.flatMap((item): VitalCard[] => {
    const card = asRecord(item);
    if (!card || !ALL_METRICS.includes(card.metric as VitalMetric)) return [];
    const metric = card.metric as VitalMetric;
    return [
      {
        metric,
        unit: THRESHOLDS[metric].unit,
        goodMax: numOrNull(card.good_max) ?? THRESHOLDS[metric].good,
        poorMin: numOrNull(card.poor_min) ?? THRESHOLDS[metric].poor,
        samples: numOrNull(card.samples) ?? 0,
        p75: numOrNull(card.p75),
        rating: ratingOf(card.rating),
        goodPct: numOrNull(card.good_pct),
        improvePct: numOrNull(card.improve_pct),
        poorPct: numOrNull(card.poor_pct),
      },
    ];
  });
  return {
    metrics,
    pageViews: numOrNull(record.page_views) ?? 0,
    firstLoads: numOrNull(record.first_loads) ?? 0,
    devices: {
      mobile: numOrNull(devices.mobile) ?? 0,
      tablet: numOrNull(devices.tablet) ?? 0,
      desktop: numOrNull(devices.desktop) ?? 0,
    },
    minSamples: numOrNull(record.min_samples) ?? 20,
  };
}

function adaptRoute(value: unknown): VitalRoute | null {
  const record = asRecord(value);
  if (!record || typeof record.route !== "string") return null;
  const metrics = asRecord(record.metrics) ?? {};
  const splitsRaw = asRecord(record.splits) ?? {};
  const splits: VitalRoute["splits"] = {};
  for (const [name, entry] of Object.entries(splitsRaw)) {
    const cells = asRecord(entry) ?? {};
    splits[name] = {
      LCP: adaptCell(cells.LCP),
      INP: adaptCell(cells.INP),
      CLS: adaptCell(cells.CLS),
    };
  }
  return {
    route: record.route,
    pageViews: numOrNull(record.page_views) ?? 0,
    enoughData: record.enough_data === true,
    rating: ratingOf(record.rating),
    metrics: {
      LCP: adaptCell(metrics.LCP),
      INP: adaptCell(metrics.INP),
      CLS: adaptCell(metrics.CLS),
      FCP: adaptCell(metrics.FCP),
      TTFB: adaptCell(metrics.TTFB),
    },
    splits,
  };
}

export function adaptVitalsRoutes(value: unknown): VitalsRoutes {
  const record = asRecord(value);
  const list = record && Array.isArray(record.routes) ? record.routes : [];
  return {
    routes: list.flatMap((item) => {
      const route = adaptRoute(item);
      return route ? [route] : [];
    }),
    minSamples: numOrNull(record?.min_samples) ?? 20,
  };
}

function adaptDiagnosis(value: unknown): Diagnosis[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Diagnosis[] => {
    const record = asRecord(item);
    if (!record) return [];
    const severity =
      record.severity === "high" || record.severity === "low"
        ? record.severity
        : "medium";
    return [
      {
        id: str(record.id),
        severity,
        title: str(record.title),
        evidence: str(record.evidence),
        action: str(record.action),
      },
    ];
  });
}

function adaptLabPage(value: unknown): LabPage | null {
  const record = asRecord(value);
  if (!record || typeof record.route !== "string") return null;
  const summary = asRecord(record.resource_summary) ?? {};
  const resourceSummary: LabPage["resourceSummary"] = {};
  for (const [kind, entry] of Object.entries(summary)) {
    const row = asRecord(entry);
    if (row)
      resourceSummary[kind] = {
        count: numOrNull(row.count) ?? 0,
        bytes: numOrNull(row.bytes) ?? 0,
      };
  }
  return {
    route: record.route,
    formFactor: record.form_factor === "desktop" ? "desktop" : "mobile",
    status: str(record.status) || "ok",
    errorSummary: str(record.error_summary),
    perfScore: numOrNull(record.perf_score),
    lcpMs: numOrNull(record.lcp_ms),
    cls: numOrNull(record.cls),
    tbtMs: numOrNull(record.tbt_ms),
    fcpMs: numOrNull(record.fcp_ms),
    ttfbMs: numOrNull(record.ttfb_ms),
    speedIndex: numOrNull(record.speed_index),
    scriptMs: numOrNull(record.script_ms),
    longTaskCount: numOrNull(record.long_task_count),
    longTaskTotalMs: numOrNull(record.long_task_total_ms),
    transferBytes: numOrNull(record.total_transfer_bytes),
    resourceCount: numOrNull(record.resource_count),
    resourceSummary,
    diagnosis: adaptDiagnosis(record.diagnosis),
  };
}

export function adaptVitalsLab(value: unknown): VitalsLab {
  const record = asRecord(value);
  if (!record) return { scan: null, pages: [] };
  const scan = asRecord(record.scan);
  const list = Array.isArray(record.pages) ? record.pages : [];
  return {
    scan: scan
      ? {
          id: str(scan.id),
          status: str(scan.status),
          completedAt: str(scan.completed_at),
          baseUrl: str(scan.base_url),
        }
      : null,
    pages: list.flatMap((item) => {
      const page = adaptLabPage(item);
      return page ? [page] : [];
    }),
  };
}

function adaptLoad(value: unknown): LoadBreakdown {
  const record = asRecord(value) ?? {};
  return {
    pageViews: numOrNull(record.page_views) ?? 0,
    ttfbMs: numOrNull(record.ttfb_ms),
    domContentLoadedMs: numOrNull(record.dom_content_loaded_ms),
    loadMs: numOrNull(record.load_ms),
    transferBytes: numOrNull(record.transfer_bytes),
    jsBytes: numOrNull(record.js_bytes),
    resourceCount: numOrNull(record.resource_count),
    longTaskCount: numOrNull(record.long_task_count),
    longTaskMs: numOrNull(record.long_task_ms),
    tbtMs: numOrNull(record.tbt_ms),
  };
}

export function adaptVitalsDetail(value: unknown, route: string): VitalsDetail {
  const record = asRecord(value);
  const field = asRecord(record?.field) ?? {};
  const load = asRecord(field.load) ?? {};
  const distribution = Array.isArray(field.distribution)
    ? field.distribution
    : [];
  const trend = Array.isArray(field.trend) ? field.trend : [];
  return {
    route,
    field: {
      summary:
        adaptRoute(field.summary) ??
        ({
          route,
          pageViews: 0,
          enoughData: false,
          rating: null,
          metrics: {
            LCP: emptyCell(),
            INP: emptyCell(),
            CLS: emptyCell(),
            FCP: emptyCell(),
            TTFB: emptyCell(),
          },
          splits: {},
        } satisfies VitalRoute),
      distribution: distribution.flatMap((item) => {
        const entry = asRecord(item);
        if (!entry || !CORE_VITALS.includes(entry.metric as CoreVital))
          return [];
        const bins = Array.isArray(entry.bins) ? entry.bins : [];
        return [
          {
            metric: entry.metric as CoreVital,
            cap: numOrNull(entry.cap) ?? 0,
            bins: bins.flatMap((bin) => {
              const b = asRecord(bin);
              return b
                ? [
                    {
                      from: numOrNull(b.from) ?? 0,
                      to: numOrNull(b.to) ?? 0,
                      count: numOrNull(b.count) ?? 0,
                      rating: ratingOf(b.rating),
                    },
                  ]
                : [];
            }),
          },
        ];
      }),
      trend: trend.flatMap((item) => {
        const point = asRecord(item);
        const time =
          typeof point?.time === "string" ? Date.parse(point.time) : NaN;
        if (!point || !Number.isFinite(time)) return [];
        return [
          {
            time,
            LCP: numOrNull(point.LCP),
            INP: numOrNull(point.INP),
            CLS: numOrNull(point.CLS),
          },
        ];
      }),
      load: {
        all: adaptLoad(load.all),
        first_load: adaptLoad(load.first_load),
        spa_navigation: adaptLoad(load.spa_navigation),
      },
    },
    lab: adaptVitalsLab(record?.lab),
  };
}

// ---- Offline sample data (used only when the API is not running) ----

const MOCK_ROUTES = [
  { route: "/dashboard", lcp: 3800, inp: 340, cls: 0.21, views: 420 },
  { route: "/users", lcp: 2900, inp: 180, cls: 0.06, views: 260 },
  { route: "/reports", lcp: 2100, inp: 90, cls: 0.03, views: 310 },
] as const;

function mockCell(
  metric: VitalMetric,
  value: number,
  samples: number,
): VitalCell {
  return { samples, p75: value, rating: rateVital(metric, value) };
}

export function mockSummary(filters: VitalFilters): VitalsSummary {
  const factor =
    filters.device === "mobile"
      ? 1.35
      : filters.device === "desktop"
        ? 0.85
        : 1;
  const base: Record<VitalMetric, number> = {
    LCP: 2480,
    INP: 190,
    CLS: 0.08,
    FCP: 1400,
    TTFB: 520,
  };
  return {
    ...emptySummary(),
    pageViews: 990,
    firstLoads: 640,
    devices: { mobile: 410, tablet: 40, desktop: 540 },
    metrics: ALL_METRICS.map((metric) => {
      const p75 =
        metric === "CLS"
          ? base[metric] * factor
          : Math.round(base[metric] * factor);
      return {
        metric,
        unit: THRESHOLDS[metric].unit,
        goodMax: THRESHOLDS[metric].good,
        poorMin: THRESHOLDS[metric].poor,
        samples: 990,
        p75,
        rating: rateVital(metric, p75),
        goodPct: 62,
        improvePct: 24,
        poorPct: 14,
      };
    }),
  };
}

export function mockRoutes(): VitalsRoutes {
  return {
    minSamples: 20,
    routes: MOCK_ROUTES.map((item) => {
      const metrics = {
        LCP: mockCell("LCP", item.lcp, item.views),
        INP: mockCell("INP", item.inp, item.views),
        CLS: mockCell("CLS", item.cls, item.views),
        FCP: mockCell("FCP", item.lcp * 0.55, item.views),
        TTFB: mockCell("TTFB", 420, item.views),
      };
      const mobile = {
        LCP: mockCell("LCP", item.lcp * 1.4, item.views / 3),
        INP: mockCell("INP", item.inp * 1.4, item.views / 3),
        CLS: mockCell("CLS", item.cls * 1.2, item.views / 3),
      };
      const desktop = {
        LCP: mockCell("LCP", item.lcp * 0.8, item.views / 2),
        INP: mockCell("INP", item.inp * 0.7, item.views / 2),
        CLS: mockCell("CLS", item.cls * 0.8, item.views / 2),
      };
      return {
        route: item.route,
        pageViews: item.views,
        enoughData: true,
        rating: (["LCP", "INP", "CLS"] as const)
          .map((m) => metrics[m].rating)
          .includes("poor")
          ? ("poor" as const)
          : (["LCP", "INP", "CLS"] as const)
                .map((m) => metrics[m].rating)
                .includes("needs-improvement")
            ? ("needs-improvement" as const)
            : ("good" as const),
        metrics,
        splits: { mobile, desktop },
      };
    }),
  };
}

export function mockLab(): VitalsLab {
  const pages: LabPage[] = [];
  for (const item of MOCK_ROUTES) {
    for (const formFactor of ["mobile", "desktop"] as const) {
      const slow = formFactor === "mobile" ? 1.6 : 0.7;
      const rng = mulberry32(hashString(`${item.route}-${formFactor}`));
      pages.push({
        route: item.route,
        formFactor,
        status: "ok",
        errorSummary: "",
        perfScore: Math.max(
          20,
          Math.round(100 - (item.lcp * slow) / 70 - rng() * 5),
        ),
        lcpMs: item.lcp * slow,
        cls: item.cls,
        tbtMs: item.inp * slow,
        fcpMs: item.lcp * slow * 0.5,
        ttfbMs: 380,
        speedIndex: item.lcp * slow * 0.9,
        scriptMs: 600 * slow,
        longTaskCount: 4,
        longTaskTotalMs: 380 * slow,
        transferBytes: 2_400_000,
        resourceCount: 38,
        resourceSummary: {
          Script: { count: 12, bytes: 900_000 },
          Image: { count: 14, bytes: 1_300_000 },
        },
        diagnosis:
          item.route === "/dashboard"
            ? [
                {
                  id: "large_image",
                  severity: "high",
                  title: "Large hero image",
                  evidence: "/assets/hero.jpg is 1.9 MB.",
                  action:
                    "Inspect image size, priority and responsive variants.",
                },
                {
                  id: "blocking_api",
                  severity: "medium",
                  title: "Blocking API request",
                  evidence: "/api/summary took 840 ms.",
                  action:
                    "Check whether the main content waits for data it does not need immediately.",
                },
                {
                  id: "long_js_task",
                  severity: "medium",
                  title: "Long JavaScript task",
                  evidence: "4 long tasks, total blocking time 520 ms.",
                  action: "Profile expensive computation and main-thread work.",
                },
              ]
            : [],
      });
    }
  }
  return {
    scan: {
      id: "sample",
      status: "completed",
      completedAt: new Date().toISOString(),
      baseUrl: "sample data",
    },
    pages,
  };
}

export function mockDetail(route: string): VitalsDetail {
  const routes = mockRoutes();
  const summary =
    routes.routes.find((item) => item.route === route) ?? routes.routes[0];
  const rng = mulberry32(hashString(route));
  const distribution = CORE_VITALS.map((metric) => {
    const cap = THRESHOLDS[metric].poor * 1.5;
    const bins = Array.from({ length: 12 }, (_, i) => {
      const from = (cap / 12) * i;
      const to = (cap / 12) * (i + 1);
      return {
        from,
        to,
        count: Math.round(
          80 * Math.exp(-Math.abs(i - 4) / 2) * (0.7 + rng() * 0.6),
        ),
        rating: rateVital(metric, (from + to) / 2),
      };
    });
    return { metric, cap, bins };
  });
  const now = Date.now();
  const trend = Array.from({ length: 24 }, (_, i) => ({
    time: now - (23 - i) * 3_600_000,
    LCP:
      summary.metrics.LCP.p75 === null
        ? null
        : summary.metrics.LCP.p75 * (0.9 + rng() * 0.25),
    INP:
      summary.metrics.INP.p75 === null
        ? null
        : summary.metrics.INP.p75 * (0.9 + rng() * 0.25),
    CLS:
      summary.metrics.CLS.p75 === null
        ? null
        : summary.metrics.CLS.p75 * (0.9 + rng() * 0.25),
  }));
  const load = (views: number): LoadBreakdown => ({
    pageViews: views,
    ttfbMs: 420,
    domContentLoadedMs: 1500,
    loadMs: 3300,
    transferBytes: 2_300_000,
    jsBytes: 880_000,
    resourceCount: 36,
    longTaskCount: 3,
    longTaskMs: 310,
    tbtMs: 190,
  });
  const lab = mockLab();
  return {
    route: summary.route,
    field: {
      summary,
      distribution,
      trend,
      load: {
        all: load(summary.pageViews),
        first_load: load(Math.round(summary.pageViews * 0.7)),
        spa_navigation: load(Math.round(summary.pageViews * 0.3)),
      },
    },
    lab: {
      ...lab,
      pages: lab.pages.filter((page) => page.route === summary.route),
    },
  };
}
