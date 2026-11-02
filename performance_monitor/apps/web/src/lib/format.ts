import type { TimeRange } from "@/lib/api/types";

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (Math.abs(ms) < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
}

export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0%";
  if (n < 0.01) return "<0.01%";
  return `${n.toFixed(n >= 10 ? 1 : 2)}%`;
}

export function formatApdex(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function formatDelta(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function formatRate(n: number): string {
  if (n < 1) return `${Math.round(n * 1024)} KB/s`;
  return `${n.toFixed(n >= 10 ? 0 : 1)} MB/s`;
}

export function formatClock(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

export function formatStamp(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ts);
}

export function formatAxis(ts: number, range: TimeRange): string {
  if (range === "7d") {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ts);
  }
  if (range === "24h" || range === "6h") {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    }).format(ts);
  }
  return formatClock(ts);
}

export function formatRelative(ts: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatKpi(value: number, unit: "ms" | "rpm" | "pct" | "apdex"): string {
  if (unit === "ms") return formatMs(value);
  if (unit === "rpm") return formatCompact(value);
  if (unit === "pct") return formatPct(value);
  return formatApdex(value);
}
