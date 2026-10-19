import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { DonutChart } from "@/components/charts/donut-chart";
import { HistogramChart } from "@/components/charts/histogram-chart";
import { StackedBar } from "@/components/charts/stacked-bar";
import { seriesColor, TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, PageSkeleton, QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useEndpointQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { endpointHealth } from "@/lib/api/mock";
import type { Timeseries } from "@/lib/api/types";
import { formatMs, formatPct, formatRelative, formatStamp } from "@/lib/format";
import { withScope } from "@/lib/scope";

export function EndpointDetailPage() {
  const params = useParams();
  const key = decodeURIComponent(params.key ?? "");
  const scope = useScope();
  const query = useEndpointQuery(key);
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    document.title = `${key || "Endpoint"} · PulseOps`;
  }, [key]);

  return (
    <QueryGate
      query={query}
      skeleton={<PageSkeleton />}
      isEmpty={(data) => !data}
      empty={<EmptyState title="Route not found in this environment" body="Pick the route from API performance, or switch back to prod where shop-api has the full catalog." />}
    >
      {(endpoint) => {
        if (!endpoint) return null;
        const split = splitByDeploy(endpoint.latency);
        return (
          <div>
            <PageHeader eyebrow={endpoint.service} title={`${endpoint.method} ${endpoint.route}`} description="Latency distribution, status mix, and where the time goes." />
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={endpointHealth(endpoint)} />
              <span className="num text-sm text-dim">p95 {formatMs(endpoint.p95Ms)}</span>
              <span className="text-sm text-mute">{formatPct(endpoint.errorRate)} errors</span>
              <span className="text-sm text-mute">apdex {endpoint.apdex.toFixed(2)}</span>
              {split ? (
                <Button size="sm" variant={compare ? "secondary" : "ghost"} onClick={() => setCompare((value) => !value)}>
                  Compare {split.version}
                </Button>
              ) : null}
              <Link to={withScope("/endpoints", scope)} className="ml-auto text-xs text-cyan hover:underline">
                All routes
              </Link>
            </div>
            {compare && split ? (
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Panel title={`Before ${split.version}`}>
                  <p className="num text-2xl text-ink">{formatMs(split.before)}</p>
                  <p className="text-xs text-mute">mean p95</p>
                </Panel>
                <Panel title={`After ${split.version}`}>
                  <p className="num text-2xl text-ink">{formatMs(split.after)}</p>
                  <p className="text-xs text-mute">
                    {split.after >= split.before ? "slower" : "faster"} by {formatMs(Math.abs(split.after - split.before))}
                  </p>
                </Panel>
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="Latency distribution">
                <HistogramChart buckets={endpoint.histogram} />
              </Panel>
              <Panel title="Status codes">
                <DonutChart slices={endpoint.statuses} />
              </Panel>
              <Panel title="Throughput">
                <TimeSeriesChart
                  ariaLabel="Endpoint throughput"
                  range={scope.range}
                  unit="rpm"
                  deploys={endpoint.throughput.deploys}
                  series={[{ name: "requests", color: seriesColor.throughput, points: endpoint.throughput.series[0]?.points ?? [], area: true }]}
                />
              </Panel>
              {endpoint.timeSpent.length > 0 ? (
                <Panel title="Time spent">
                  <StackedBar segments={endpoint.timeSpent} />
                </Panel>
              ) : null}
            </div>
            {endpoint.traces.length > 0 ? (
            <Panel className="mt-4" title="Slowest traces" description="Waterfall view ships with Traces.">
              <ul className="divide-y divide-line">
                {endpoint.traces.map((trace) => (
                  <li key={trace.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="num text-ink">{trace.id}</span>
                    <span className="num text-dim">{formatMs(trace.durationMs)}</span>
                    <span className={trace.status >= 500 ? "text-danger" : "text-success"}>{trace.status}</span>
                    <span className="text-xs text-mute">{formatStamp(trace.time)} · {formatRelative(trace.time)}</span>
                    <Link to={withScope("/traces", scope)} className="text-xs text-cyan hover:underline">
                      Waterfall soon
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
            ) : null}
          </div>
        );
      }}
    </QueryGate>
  );
}

function splitByDeploy(series: Timeseries) {
  const line = series.series.find((item) => item.name === "p95");
  const deploy = [...series.deploys].sort((a, b) => a.time - b.time).at(-1);
  if (!line || !deploy) return null;
  const before = line.points.filter((point) => point[0] < deploy.time).map((point) => point[1]);
  const after = line.points.filter((point) => point[0] >= deploy.time).map((point) => point[1]);
  if (before.length < 2 || after.length < 2) return null;
  const avg = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return { version: deploy.version, before: avg(before), after: avg(after) };
}
