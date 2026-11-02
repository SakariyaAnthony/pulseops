import { useEffect, useState } from "react";
import { HeatmapChart } from "@/components/charts/heatmap-chart";
import { seriesColor, TimeSeriesChart } from "@/components/charts/time-series-chart";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { EmptyState, PageSkeleton, QueryGate } from "@/components/shared/states";
import { useResourcesQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import type { ResourceBundle } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export function ResourcesPage() {
  const scope = useScope();
  const query = useResourcesQuery();
  const [host, setHost] = useState("all");

  useEffect(() => {
    document.title = "Resources · PulseOps";
  }, []);

  return (
    <QueryGate
      query={query}
      skeleton={<PageSkeleton />}
      isEmpty={(data) => data.empty}
      empty={<EmptyState title="No host metrics in this environment" body="CPU, memory, disk, and network show up after the SDK reports a process heartbeat." />}
    >
      {(data) => {
        const bundle: ResourceBundle = host === "all" ? data.aggregate : (data.byHost[host] ?? data.aggregate);
        return (
          <div>
            <PageHeader
              eyebrow={`${scope.project} · ${scope.env}`}
              title="Resources"
              description="Saturation across hosts. Shaded bands mark the warning and critical CPU thresholds."
            />
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              <HostChip active={host === "all"} onClick={() => setHost("all")} label="All hosts" />
              {data.hosts.map((item) => (
                <HostChip key={item.host} active={host === item.host} onClick={() => setHost(item.host)} label={item.host} detail={`${item.cpu}%`} />
              ))}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="CPU">
                <TimeSeriesChart
                  ariaLabel="CPU"
                  range={scope.range}
                  unit="pct"
                  thresholds={{ warning: 70, critical: 85 }}
                  deploys={bundle.cpu.deploys}
                  series={[{ name: "cpu", color: seriesColor.cpu, points: bundle.cpu.series[0]?.points ?? [], area: true }]}
                />
              </Panel>
              <Panel title="Memory">
                <TimeSeriesChart
                  ariaLabel="Memory"
                  range={scope.range}
                  unit="pct"
                  thresholds={{ warning: 75, critical: 90 }}
                  deploys={bundle.memory.deploys}
                  series={[{ name: "memory", color: seriesColor.memory, points: bundle.memory.series[0]?.points ?? [], area: true }]}
                />
              </Panel>
              <Panel title="Disk">
                <TimeSeriesChart
                  ariaLabel="Disk throughput"
                  range={scope.range}
                  unit="rate"
                  deploys={bundle.disk.deploys}
                  series={[
                    { name: "read", color: seriesColor.read, points: find(bundle.disk, "read") },
                    { name: "write", color: seriesColor.write, points: find(bundle.disk, "write") },
                  ]}
                />
              </Panel>
              <Panel title="Network">
                <TimeSeriesChart
                  ariaLabel="Network throughput"
                  range={scope.range}
                  unit="rate"
                  deploys={bundle.network.deploys}
                  series={[
                    { name: "in", color: seriesColor.netIn, points: find(bundle.network, "in") },
                    { name: "out", color: seriesColor.netOut, points: find(bundle.network, "out") },
                  ]}
                />
              </Panel>
              <Panel title="Event-loop lag" className="lg:col-span-2">
                <TimeSeriesChart
                  ariaLabel="Event loop lag"
                  range={scope.range}
                  unit="ms"
                  height={220}
                  deploys={bundle.lag.deploys}
                  series={[{ name: "lag", color: seriesColor.lag, points: bundle.lag.series[0]?.points ?? [], area: true }]}
                />
              </Panel>
              <Panel title="CPU across instances" className="lg:col-span-2" description="Each row is a host. Hotter cells are closer to saturation.">
                <HeatmapChart hosts={data.heatmap.hosts} times={data.heatmap.times} values={data.heatmap.values} />
              </Panel>
            </div>
          </div>
        );
      }}
    </QueryGate>
  );
}

function HostChip({ active, onClick, label, detail }: { active: boolean; onClick: () => void; label: string; detail?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1 text-xs",
        active ? "border-violet bg-violet/15 text-ink" : "border-line text-dim hover:text-ink",
      )}
    >
      <span className="num">{label}</span>
      {detail ? <span className="ml-2 text-mute">{detail}</span> : null}
    </button>
  );
}

function find(bundle: { series: { name: string; points: [number, number][] }[] }, name: string) {
  return bundle.series.find((item) => item.name === name)?.points ?? [];
}
