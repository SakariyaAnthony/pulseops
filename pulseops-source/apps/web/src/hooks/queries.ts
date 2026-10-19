import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { useScope } from "@/hooks/use-scope";
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
    queryKey: ["service", name, scope.project, scope.env, scope.range, scope.chaos],
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
    queryKey: ["endpoint", key, scope.project, scope.env, scope.range, scope.chaos],
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

export function useSettingsQuery() {
  const scope = useScope();
  return useQuery({
    queryKey: ["settings", scope.project, scope.chaos],
    queryFn: () => api.settings(scope),
  });
}
