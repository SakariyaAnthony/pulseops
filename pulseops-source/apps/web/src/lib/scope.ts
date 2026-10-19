import { ENVIRONMENTS, TIME_RANGES, type EnvName, type Scope, type TimeRange } from "@/lib/api/types";

export const RANGE_LABEL: Record<TimeRange, string> = {
  "15m": "Last 15 minutes",
  "1h": "Last hour",
  "6h": "Last 6 hours",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
};

export function parseRange(value: string | null): TimeRange {
  return TIME_RANGES.find((range) => range === value) ?? "1h";
}

export function parseEnv(value: string | null): EnvName {
  return ENVIRONMENTS.find((env) => env === value) ?? "prod";
}

export function scopeSearch(scope: Pick<Scope, "project" | "env" | "range" | "chaos">): string {
  const params = new URLSearchParams();
  params.set("project", scope.project);
  params.set("env", scope.env);
  params.set("range", scope.range);
  if (scope.chaos) params.set("chaos", "1");
  return params.toString();
}

export function withScope(path: string, scope: Pick<Scope, "project" | "env" | "range" | "chaos">): string {
  return `${path}?${scopeSearch(scope)}`;
}
