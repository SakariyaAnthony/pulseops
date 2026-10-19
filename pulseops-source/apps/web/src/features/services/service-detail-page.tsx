import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { seriesColor, TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, PageSkeleton, QueryGate } from "@/components/shared/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EndpointTable } from "@/features/api-performance/endpoint-table";
import { DependencyMap } from "@/features/services/dependency-map";
import { useServiceQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { formatCompact, formatMs, formatPct, formatStamp } from "@/lib/format";
import { withScope } from "@/lib/scope";

export function ServiceDetailPage() {
  const { name = "" } = useParams();
  const scope = useScope();
  const query = useServiceQuery(name);

  useEffect(() => {
    document.title = `${name} · PulseOps`;
  }, [name]);

  return (
    <QueryGate
      query={query}
      skeleton={<PageSkeleton />}
      isEmpty={(data) => !data}
      empty={
        <EmptyState
          title={`No telemetry for ${name || "this service"}`}
          body="This environment has not reported the service yet. Prod and staging on shop-api already have a full day of traffic."
        />
      }
    >
      {(service) =>
        service ? (
          <div>
            <PageHeader
              eyebrow={`${scope.project} · ${scope.env}`}
              title={service.name}
              description={
                [service.description, service.language, service.instances ? `${service.instances} instances` : null, service.version]
                  .filter(Boolean)
                  .join(" · ") || "Telemetry reported by this service."
              }
            />
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={service.health} />
              <span className="num text-sm text-dim">{formatMs(service.latencyMs)} p95-ish</span>
              <span className="text-sm text-mute">{formatCompact(service.rpm)} rpm</span>
              <span className="text-sm text-mute">{formatPct(service.errorRate)} errors</span>
            </div>
            <Tabs defaultValue="overview">
              <TabsList className="flex-wrap">
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="endpoints">Endpoints</TabsTrigger>
                <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
                <TabsTrigger value="resources">Resources</TabsTrigger>
                <TabsTrigger value="deploys">Deploys</TabsTrigger>
              </TabsList>
              <TabsContent value="overview">
                <div className="grid gap-4 lg:grid-cols-2">
                  <Panel title="Latency">
                    <TimeSeriesChart
                      ariaLabel={`${service.name} latency`}
                      range={scope.range}
                      unit="ms"
                      deploys={service.latency.deploys}
                      series={[
                        { name: "p50", color: seriesColor.p50, points: findSeries(service.latency.series, "p50"), area: true },
                        { name: "p95", color: seriesColor.p95, points: findSeries(service.latency.series, "p95"), area: true },
                      ]}
                    />
                  </Panel>
                  {findSeries(service.errors.series, "errors").length > 0 ? (
                    <Panel title="Error rate">
                      <TimeSeriesChart
                        ariaLabel={`${service.name} error rate`}
                        range={scope.range}
                        unit="pct"
                        deploys={service.errors.deploys}
                        series={[{ name: "errors", color: seriesColor.errors, points: findSeries(service.errors.series, "errors"), area: true }]}
                      />
                    </Panel>
                  ) : null}
                </div>
              </TabsContent>
              <TabsContent value="endpoints">
                {service.endpoints.length === 0 ? (
                  <p className="text-sm text-dim">No routes attributed to this service in the current range.</p>
                ) : (
                  <EndpointTable rows={service.endpoints} />
                )}
              </TabsContent>
              <TabsContent value="dependencies">
                {service.dependencies.nodes.length === 0 ? (
                  <p className="text-sm text-dim">Dependency edges need span data, which this scan does not collect.</p>
                ) : (
                  <Panel title="Dependency map" description="Edge thickness follows traffic. Color follows latency and error health.">
                    <DependencyMap nodes={service.dependencies.nodes} edges={service.dependencies.edges} highlight={service.name} />
                  </Panel>
                )}
              </TabsContent>
              <TabsContent value="resources">
                {service.hosts.length === 0 ? <p className="text-sm text-dim">No host samples in this range.</p> : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  {service.hosts.map((instance) => (
                    <div key={instance.host} className="glass shadow-card rounded-xl2 p-4">
                      <div className="flex items-center justify-between">
                        <p className="num text-sm text-ink">{instance.host}</p>
                        <StatusBadge status={instance.status} />
                      </div>
                      <p className="mt-2 text-xs text-dim">
                        CPU {instance.cpu}% · memory {instance.mem}%
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-base">
                        <div className="h-full rounded-full bg-violet" style={{ width: `${instance.cpu}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
                <Link to={withScope("/resources", scope)} className="mt-4 inline-block text-xs text-cyan hover:underline">
                  Open fleet resources
                </Link>
              </TabsContent>
              <TabsContent value="deploys">
                <ol className="space-y-3">
                  {service.deploys.map((deploy) => (
                    <li key={deploy.version} className="glass shadow-card rounded-xl2 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="num text-sm text-ink">{deploy.version}</p>
                        <p className="text-xs text-mute">{formatStamp(deploy.time)}</p>
                      </div>
                      <p className="mt-2 text-sm text-dim">{deploy.note}</p>
                    </li>
                  ))}
                </ol>
              </TabsContent>
            </Tabs>
          </div>
        ) : null
      }
    </QueryGate>
  );
}

function findSeries(series: { name: string; points: [number, number][] }[], name: string) {
  return series.find((item) => item.name === name)?.points ?? [];
}
