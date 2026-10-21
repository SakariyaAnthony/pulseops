import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { buildCapture } from "@/lib/api/adapt";
import { useScope } from "@/hooks/use-scope";
import type { VitalFilters } from "@/lib/api/vitals";
import { useUi } from "@/store/ui";

function useLiveInterval() {
  return useUi((state) => (state.live ? 5_000 : false));
}

export function useProjectsQuery() {
  const chaos = useScope().chaos;
  return useQuery({
    queryKey: ["projects", chaos],
    queryFn: () => api.projects(chaos),
    staleTime: 60_000,
  });
}

export function useOverviewQuery() {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["overview", scope.project, scope.env, scope.range, scope.chaos],
    queryFn: () => api.overview(scope),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useServicesQuery() {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["services", scope.project, scope.env, scope.range, scope.chaos],
    queryFn: () => api.services(scope),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useServiceQuery(name: string) {
  const scope = useScope();
  return useQuery({
    queryKey: [
      "service",
      name,
      scope.project,
      scope.env,
      scope.range,
      scope.chaos,
    ],
    queryFn: () => api.service(scope, name),
    placeholderData: keepPreviousData,
  });
}

export function useEndpointsQuery() {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["endpoints", scope.project, scope.env, scope.range, scope.chaos],
    queryFn: () => api.endpoints(scope),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useEndpointQuery(key: string) {
  const scope = useScope();
  return useQuery({
    queryKey: [
      "endpoint",
      key,
      scope.project,
      scope.env,
      scope.range,
      scope.chaos,
    ],
    queryFn: () => api.endpoint(scope, key),
    placeholderData: keepPreviousData,
  });
}

export function useResourcesQuery() {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["resources", scope.project, scope.env, scope.range, scope.chaos],
    queryFn: () => api.resources(scope),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useErrorsQuery() {
  const scope = useScope();
  return useQuery({
    queryKey: ["errors", scope.project, scope.env, scope.chaos],
    queryFn: () => api.errors(scope),
    placeholderData: keepPreviousData,
  });
}

export function useErrorQuery(fingerprint: string | null) {
  const scope = useScope();
  return useQuery({
    queryKey: ["error", fingerprint, scope.project, scope.env, scope.chaos],
    queryFn: () => api.error(scope, fingerprint ?? ""),
    enabled: !!fingerprint,
  });
}

export function useRulesQuery() {
  const scope = useScope();
  return useQuery({
    queryKey: ["rules", scope.project, scope.chaos],
    queryFn: () => api.rules(scope),
  });
}

export function useIncidentsQuery() {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["incidents", scope.project, scope.env, scope.chaos],
    queryFn: () => api.incidents(scope),
    refetchInterval: interval,
  });
}

export function useInsightsQuery() {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["insights", scope.project, scope.env, scope.range, scope.chaos],
    queryFn: () => api.insights(scope),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useScansQuery() {
  const scope = useScope();
  return useQuery({
    queryKey: ["scans", scope.project],
    queryFn: () => api.scans(scope.project),
    refetchInterval: (query) =>
      query.state.data?.some(
        (scan) => scan.status === "queued" || scan.status === "running",
      )
        ? 1500
        : false,
  });
}

export function useScanQuery(id: string) {
  return useQuery({
    queryKey: ["scan", id],
    queryFn: () => api.scan(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 2000 : false;
    },
  });
}

export function useScanAssetsQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["scan-assets", id],
    queryFn: () => api.scanAssets(id),
    enabled,
  });
}

export function useScanApisQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["scan-apis", id],
    queryFn: () => api.scanApis(id),
    enabled,
  });
}

export function useScanPagesQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["scan-pages", id],
    queryFn: () => api.scanPages(id),
    enabled,
  });
}

export function useSettingsQuery() {
  const scope = useScope();
  return useQuery({
    queryKey: ["settings", scope.project, scope.chaos],
    queryFn: () => api.settings(scope),
  });
}

/**
 * API performance measured by the latest finished runtime scan of the running app.
 * `running` is the scan in progress, if any, so pages can show progress instead of stale numbers.
 */
export function useCapture(serviceName: string) {
  const scans = useScansQuery();
  const latest = scans.data?.find(
    (scan) =>
      (scan.mode === "browser" || scan.mode === "full") &&
      (scan.status === "completed" || scan.status === "partial"),
  );
  const running = scans.data?.find(
    (scan) => scan.status === "queued" || scan.status === "running",
  );
  // The newest scan, when it was a runtime scan that failed outright (usually the app was not running).
  const newest = scans.data?.[0];
  const failed =
    newest &&
    (newest.mode === "browser" || newest.mode === "full") &&
    newest.status === "failed"
      ? newest
      : null;
  const apis = useScanApisQuery(latest?.id ?? "", Boolean(latest));
  const capture = useMemo(
    () =>
      latest && apis.data ? buildCapture(latest, apis.data, serviceName) : null,
    [latest, apis.data, serviceName],
  );
  return {
    capture,
    running,
    failed,
    loading: scans.isLoading || (Boolean(latest) && apis.isLoading),
  };
}

export function useVitalsSummaryQuery(filters: VitalFilters) {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["vitals-summary", scope.project, scope.env, scope.range, scope.chaos, filters.device, filters.nav],
    queryFn: () => api.vitalsSummary(scope, filters),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useVitalsRoutesQuery(filters: VitalFilters) {
  const scope = useScope();
  const interval = useLiveInterval();
  return useQuery({
    queryKey: ["vitals-routes", scope.project, scope.env, scope.range, scope.chaos, filters.device, filters.nav],
    queryFn: () => api.vitalsRoutes(scope, filters),
    placeholderData: keepPreviousData,
    refetchInterval: interval,
  });
}

export function useVitalsDetailQuery(route: string | null, filters: VitalFilters) {
  const scope = useScope();
  return useQuery({
    queryKey: ["vitals-detail", route, scope.project, scope.env, scope.range, scope.chaos, filters.device, filters.nav],
    queryFn: () => api.vitalsDetail(scope, route ?? "", filters),
    enabled: Boolean(route),
    placeholderData: keepPreviousData,
  });
}

export function useVitalsLabQuery() {
  const scope = useScope();
  return useQuery({
    queryKey: ["vitals-lab", scope.project, scope.chaos],
    queryFn: () => api.vitalsLab(scope),
  });
}
