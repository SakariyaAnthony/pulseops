import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/shared/page-header";
import { InlineError } from "@/components/shared/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldTab } from "@/features/web-vitals/field-tab";
import { LabTab } from "@/features/web-vitals/lab-tab";
import { Segmented } from "@/components/shared/segmented";
import {
  useVitalsLabQuery,
  useVitalsRoutesQuery,
  useVitalsSummaryQuery,
} from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import type { DeviceFilter, NavFilter, VitalFilters } from "@/lib/api/vitals";

const DEVICES: DeviceFilter[] = ["all", "mobile", "tablet", "desktop"];
const NAVS: NavFilter[] = ["all", "first_load", "spa_navigation"];

function pick<T extends string>(
  value: string | null,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function WebVitalsPage() {
  const scope = useScope();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "lab" ? "lab" : "field";
  const filters: VitalFilters = {
    device: pick(params.get("device"), DEVICES, "all"),
    nav: pick(params.get("nav"), NAVS, "all"),
  };

  const summary = useVitalsSummaryQuery(filters);
  const routes = useVitalsRoutesQuery(filters);
  const lab = useVitalsLabQuery();

  useEffect(() => {
    document.title = "Web Vitals · PulseOps";
  }, []);

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "all") next.delete(key);
          else next.set(key, value);
        }
        return next;
      },
      { replace: true },
    );

  // The chosen route, or the worst one when none is chosen or the choice no longer exists in this tab.
  const requested = params.get("route");
  const knownRoutes = useMemo(() => {
    const names =
      tab === "lab"
        ? (lab.data?.pages ?? []).map((page) => page.route)
        : (routes.data?.routes ?? []).map((route) => route.route);
    return Array.from(new Set(names));
  }, [tab, lab.data, routes.data]);
  const selected =
    requested && knownRoutes.includes(requested)
      ? requested
      : (knownRoutes[0] ?? null);

  return (
    <div>
      <PageHeader
        eyebrow={`${scope.project} · ${scope.env}`}
        title="Web Vitals"
        description="How fast pages load and respond. Field results come from real users. Lab results come from a Lighthouse test you run on demand. They are kept apart on purpose."
      />
      <Tabs
        value={tab}
        onValueChange={(next) => update({ tab: next === "lab" ? "lab" : null })}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="field">Field · real users</TabsTrigger>
            <TabsTrigger value="lab">Lab · Lighthouse</TabsTrigger>
          </TabsList>
          {tab === "field" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="Device"
                value={filters.device}
                onChange={(device) => update({ device })}
                options={[
                  { id: "all", label: "All devices" },
                  { id: "mobile", label: "Mobile" },
                  { id: "tablet", label: "Tablet" },
                  { id: "desktop", label: "Desktop" },
                ]}
              />
              <Segmented
                label="Navigation"
                value={filters.nav}
                onChange={(nav) => update({ nav })}
                options={[
                  { id: "all", label: "All visits" },
                  { id: "first_load", label: "First load" },
                  { id: "spa_navigation", label: "Navigation" },
                ]}
              />
            </div>
          ) : null}
        </div>
        <TabsContent value="field">
          {summary.isError || routes.isError ? (
            <InlineError
              title="Could not load Web Vitals"
              message={
                (summary.error ?? routes.error) instanceof Error
                  ? String((summary.error ?? routes.error)?.message)
                  : "The API did not respond."
              }
              onRetry={() => {
                void summary.refetch();
                void routes.refetch();
              }}
              pending={summary.isFetching || routes.isFetching}
            />
          ) : (
            <FieldTab
              summary={summary.data}
              routes={routes.data}
              filters={filters}
              selected={selected}
              onSelect={(route) => update({ route })}
              loading={summary.isLoading || routes.isLoading}
            />
          )}
        </TabsContent>
        <TabsContent value="lab">
          <LabTab selected={selected} onSelect={(route) => update({ route })} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
