import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EndpointTable } from "@/features/api-performance/endpoint-table";
import { useEndpointsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import type { EndpointRow } from "@/lib/api/types";

const VIEWS = [
  { id: "all", label: "All routes" },
  { id: "slow", label: "Slow checkouts" },
  { id: "errors", label: "Error hotspots" },
] as const;

export function EndpointsPage() {
  const scope = useScope();
  const query = useEndpointsQuery();
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("all");
  const [method, setMethod] = useState("ALL");
  const [service, setService] = useState("all");
  const [minLatency, setMinLatency] = useState("0");
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "API performance · PulseOps";
  }, []);

  return (
    <QueryGate
      query={query}
      skeleton={<Skeleton className="h-96" />}
      isEmpty={(rows) => rows.length === 0}
      empty={<EmptyState title="No routes in this environment" body="API performance appears after the first traced requests land in the project." />}
    >
      {(rows) => {
        const services = Array.from(new Set(rows.map((row) => row.service)));
        return (
          <div>
            <PageHeader
              eyebrow={`${scope.project} · ${scope.env}`}
              title="API performance"
              description="Sort by percentile, hide columns, and open a route for its histogram and time split."
            />
            <FilterBar
              view={view}
              method={method}
              service={service}
              minLatency={minLatency}
              search={search}
              services={services}
              onView={(next) => {
                setView(next);
                if (next === "slow") {
                  setMethod("POST");
                  setSearch("checkout");
                  setMinLatency("300");
                  setService("all");
                } else if (next === "errors") {
                  setMethod("ALL");
                  setSearch("");
                  setMinLatency("0");
                  setService("all");
                } else {
                  setMethod("ALL");
                  setSearch("");
                  setMinLatency("0");
                  setService("all");
                }
              }}
              onMethod={setMethod}
              onService={setService}
              onMin={setMinLatency}
              onSearch={setSearch}
            />
            <FilteredTable rows={rows} view={view} method={method} service={service} minLatency={Number(minLatency)} search={search} />
          </div>
        );
      }}
    </QueryGate>
  );
}

function FilteredTable({
  rows,
  view,
  method,
  service,
  minLatency,
  search,
}: {
  rows: EndpointRow[];
  view: string;
  method: string;
  service: string;
  minLatency: number;
  search: string;
}) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (method !== "ALL" && row.method !== method) return false;
      if (service !== "all" && row.service !== service) return false;
      if (row.p95Ms < minLatency) return false;
      if (view === "errors" && row.errorRate < 1) return false;
      if (!needle) return true;
      return `${row.method} ${row.route} ${row.service}`.toLowerCase().includes(needle);
    });
  }, [method, minLatency, rows, search, service, view]);

  if (filtered.length === 0) {
    return <p className="mt-6 text-sm text-dim">No routes match these filters.</p>;
  }
  return (
    <div className="mt-4">
      <EndpointTable rows={filtered} />
    </div>
  );
}

function FilterBar({
  view,
  method,
  service,
  minLatency,
  search,
  services,
  onView,
  onMethod,
  onService,
  onMin,
  onSearch,
}: {
  view: (typeof VIEWS)[number]["id"];
  method: string;
  service: string;
  minLatency: string;
  search: string;
  services: string[];
  onView: (view: (typeof VIEWS)[number]["id"]) => void;
  onMethod: (value: string) => void;
  onService: (value: string) => void;
  onMin: (value: string) => void;
  onSearch: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {VIEWS.map((item) => (
          <Button key={item.id} size="sm" variant={view === item.id ? "secondary" : "ghost"} onClick={() => onView(item.id)}>
            {item.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search routes" aria-label="Search routes" />
        <Select value={method} onValueChange={onMethod}>
          <SelectTrigger aria-label="Method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"].map((item) => (
              <SelectItem key={item} value={item}>
                {item === "ALL" ? "All methods" : item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={service} onValueChange={onService}>
          <SelectTrigger aria-label="Service">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All services</SelectItem>
            {services.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minLatency} onValueChange={onMin}>
          <SelectTrigger aria-label="Minimum p95">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Any latency</SelectItem>
            <SelectItem value="100">p95 over 100 ms</SelectItem>
            <SelectItem value="300">p95 over 300 ms</SelectItem>
            <SelectItem value="800">p95 over 800 ms</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
