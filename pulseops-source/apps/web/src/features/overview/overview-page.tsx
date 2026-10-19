import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { seriesColor, TimeSeriesChart, type ZoomWindow } from "@/components/charts/time-series-chart";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, PageSkeleton, QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useOverviewQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { formatCompact, formatMs, formatPct, formatRelative } from "@/lib/format";
import { RANGE_LABEL, withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export function OverviewPage() {
  const scope = useScope();
  const query = useOverviewQuery();
  const zoomKey = `${scope.project}:${scope.env}:${scope.range}`;
  const [zoomState, setZoomState] = useState<{ key: string; zoom: ZoomWindow } | null>(null);
  const zoom = zoomState?.key === zoomKey ? zoomState.zoom : null;

  useEffect(() => {
    document.title = "Overview · PulseOps";
  }, []);

  return (
    <QueryGate
      query={query}
      skeleton={<PageSkeleton />}
      isEmpty={(data) => data.empty}
      empty={
        <EmptyState
          title="No telemetry in this environment yet"
          body="Dev is quiet on purpose. Point the SDK at it and the same overview fills in with latency, errors, and saturation."
        />
      }
    >
      {(data) => {
        const maxP95 = Math.max(...data.slowEndpoints.map((row) => row.p95Ms), 1);
        return (
          <div>
            <PageHeader
              eyebrow={`${scope.project} · ${scope.env}`}
              title="System health"
              description={`${RANGE_LABEL[scope.range]}. Dashed lines are deploys. Scroll a chart to zoom every series on this page together.`}
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {data.kpis.map((kpi) => (
                <KpiCard key={kpi.id} kpi={kpi} />
              ))}
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-12">
              <Panel
                className="xl:col-span-8"
                title="Response time"
                description="p50, p95, and p99"
                action={
                  zoom ? (
                    <Button variant="ghost" size="sm" onClick={() => setZoomState(null)}>
                      Reset zoom
                    </Button>
                  ) : null
                }
              >
                <TimeSeriesChart
                  ariaLabel="Response time percentiles"
                  range={scope.range}
                  unit="ms"
                  syncGroup="overview"
                  zoom={zoom}
                  onZoom={(next) => setZoomState({ key: zoomKey, zoom: next })}
                  deploys={data.responseTime.deploys}
                  series={[
                    { name: "p50", color: seriesColor.p50, points: seriesBy(data.responseTime.series, "p50"), area: true },
                    { name: "p95", color: seriesColor.p95, points: seriesBy(data.responseTime.series, "p95"), area: true },
                    { name: "p99", color: seriesColor.p99, points: seriesBy(data.responseTime.series, "p99") },
                  ]}
                />
              </Panel>
              <Panel className="xl:col-span-4" title="Throughput" description="Requests per minute">
                <TimeSeriesChart
                  ariaLabel="Throughput"
                  range={scope.range}
                  unit="rpm"
                  height={260}
                  syncGroup="overview"
                  zoom={zoom}
                  onZoom={(next) => setZoomState({ key: zoomKey, zoom: next })}
                  deploys={data.throughput.deploys}
                  series={[{ name: "requests", color: seriesColor.throughput, points: seriesBy(data.throughput.series, "requests"), area: true }]}
                />
              </Panel>
              <Panel className="xl:col-span-5" title="CPU and memory" description="Fleet average, with warning and critical bands">
                <TimeSeriesChart
                  ariaLabel="CPU and memory"
                  range={scope.range}
                  unit="pct"
                  height={240}
                  syncGroup="overview"
                  zoom={zoom}
                  onZoom={(next) => setZoomState({ key: zoomKey, zoom: next })}
                  thresholds={{ warning: 70, critical: 85 }}
                  deploys={data.cpuMemory.deploys}
                  series={[
                    { name: "cpu", color: seriesColor.cpu, points: seriesBy(data.cpuMemory.series, "cpu") },
                    { name: "memory", color: seriesColor.memory, points: seriesBy(data.cpuMemory.series, "memory") },
                  ]}
                />
              </Panel>
              <Panel className="xl:col-span-4" title="Slowest endpoints">
                <ul className="space-y-3">
                  {data.slowEndpoints.map((row) => (
                    <li key={row.key}>
                      <Link to={withScope(`/endpoints/${encodeURIComponent(row.key)}`, scope)} className="block rounded-lg hover:bg-white/[0.03]">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="truncate text-ink">
                            <span className="text-mute">{row.method}</span> {row.route}
                          </span>
                          <span className="num text-dim">{formatMs(row.p95Ms)}</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-base">
                          <div className="h-full rounded-full bg-violet" style={{ width: `${(row.p95Ms / maxP95) * 100}%` }} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel className="xl:col-span-3" title="Signals" description="Preview of the insights feed">
                <ul className="space-y-3">
                  {data.insights.map((insight) => (
                    <li key={insight.id} className="rounded-lg border border-line bg-base/40 p-3">
                      <p className={cn("text-[11px] font-medium uppercase tracking-wide", insight.severity === "critical" ? "text-danger" : insight.severity === "warning" ? "text-warning" : "text-info")}>
                        {insight.severity}
                      </p>
                      <p className="mt-1 text-sm text-ink">{insight.title}</p>
                      <p className="mt-1 text-xs leading-5 text-dim">{insight.body}</p>
                      <Link to={withScope(insight.href, scope)} className="mt-2 inline-block text-xs text-cyan hover:underline">
                        Open evidence
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel className="xl:col-span-7" title="Service health">
                <div className="grid gap-2 sm:grid-cols-2">
                  {data.services.map((service) => (
                    <Link
                      key={service.name}
                      to={withScope(`/services/${service.name}`, scope)}
                      className="rounded-xl2 border border-line bg-base/40 p-3 hover:border-violet/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-medium text-ink">{service.name}</p>
                        <StatusBadge status={service.health} />
                      </div>
                      <p className="mt-2 text-xs text-mute">
                        {formatMs(service.latencyMs)} · {formatCompact(service.rpm)} rpm · {formatPct(service.errorRate)}
                      </p>
                    </Link>
                  ))}
                </div>
              </Panel>
              <Panel className="xl:col-span-5" title="Incidents">
                {data.incidents.length === 0 ? (
                  <p className="text-sm text-dim">Nothing firing in this environment.</p>
                ) : (
                  <ul className="space-y-3">
                    {data.incidents.map((incident) => (
                      <li key={incident.id} className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-ink">{incident.title}</p>
                          <p className="text-xs text-mute">
                            {incident.service} · {formatRelative(incident.startedAt)}
                          </p>
                        </div>
                        <StatusBadge status={incident.status} />
                      </li>
                    ))}
                  </ul>
                )}
                <Link to={withScope("/alerts", scope)} className="mt-4 inline-block text-xs text-cyan hover:underline">
                  Alert rules
                </Link>
              </Panel>
            </div>
          </div>
        );
      }}
    </QueryGate>
  );
}

function seriesBy(series: { name: string; points: [number, number][] }[], name: string) {
  return series.find((item) => item.name === name)?.points ?? [];
}
