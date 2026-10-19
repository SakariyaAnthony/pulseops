import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutGrid, List } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Sparkline } from "@/components/shared/sparkline";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState, QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { useServicesQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { formatCompact, formatMs, formatPct } from "@/lib/format";
import { withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

export function ServicesPage() {
  const scope = useScope();
  const query = useServicesQuery();
  const [mode, setMode] = useState<"grid" | "list">("grid");

  useEffect(() => {
    document.title = "Services · PulseOps";
  }, []);

  return (
    <QueryGate
      query={query}
      skeleton={<SkeletonBlock />}
      isEmpty={(rows) => rows.length === 0}
      empty={<EmptyState title="No services reporting" body="Once a service boots with the SDK, it shows up here with latency, throughput, and error rate." />}
    >
      {(services) => (
        <div>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <PageHeader eyebrow={scope.project} title="Services" description="Health, latency, and traffic for every process shipping telemetry." />
            <div className="mb-5 flex rounded-lg border border-line p-0.5">
              <Button variant={mode === "grid" ? "secondary" : "ghost"} size="icon" aria-label="Grid" onClick={() => setMode("grid")}>
                <LayoutGrid className="h-4 w-4" />
              </Button>
              <Button variant={mode === "list" ? "secondary" : "ghost"} size="icon" aria-label="List" onClick={() => setMode("list")}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className={cn(mode === "grid" ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "space-y-2")}>
            {services.map((service) => (
              <Link
                key={service.name}
                to={withScope(`/services/${service.name}`, scope)}
                className="glass shadow-card block rounded-xl2 p-4 hover:border-violet/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{service.name}</p>
                    {service.description ? <p className="mt-1 text-xs text-mute">{service.description}</p> : null}
                  </div>
                  <StatusBadge status={service.health} />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Latency" value={formatMs(service.latencyMs)} />
                  <Stat label="Throughput" value={`${formatCompact(service.rpm)} rpm`} />
                  <Stat label="Errors" value={formatPct(service.errorRate)} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-mute">
                    {[service.instances ? `${service.instances} instances` : null, service.version, service.language].filter(Boolean).join(" · ") || "Live telemetry"}
                  </p>
                  <div className="w-24">
                    <Sparkline data={service.spark} color={service.health === "critical" ? "#F43F5E" : "#22D3EE"} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </QueryGate>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-mute">{label}</p>
      <p className="num mt-0.5 text-ink">{value}</p>
    </div>
  );
}

function SkeletonBlock() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-40" />
      ))}
    </div>
  );
}
