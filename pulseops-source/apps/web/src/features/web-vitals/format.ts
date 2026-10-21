import {
  formatVital,
  THRESHOLDS,
  type VitalMetric,
  type VitalRating,
} from "@/lib/api/vitals";

export const RATING_TEXT: Record<VitalRating, string> = {
  good: "text-success",
  "needs-improvement": "text-warning",
  poor: "text-danger",
};

export const RATING_BG: Record<VitalRating, string> = {
  good: "bg-success",
  "needs-improvement": "bg-warning",
  poor: "bg-danger",
};

export const RATING_LABEL: Record<VitalRating, string> = {
  good: "Good",
  "needs-improvement": "Needs improvement",
  poor: "Poor",
};

export function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000
    ? `${(value / 1000).toFixed(2)} s`
    : `${Math.round(value)} ms`;
}

export function thresholdText(metric: VitalMetric): string {
  const t = THRESHOLDS[metric];
  return `Good ≤ ${formatVital(metric, t.good)} · Poor > ${formatVital(metric, t.poor)}`;
}
