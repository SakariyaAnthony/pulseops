import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Camera, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { InlineError } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EndpointTable } from "@/features/api-performance/endpoint-table";
import type { ScanMode } from "@/features/scans/scan-mode-picker";
import { ScanProgress } from "@/features/scans/scan-progress";
import {
  useCapture,
  useEndpointsQuery,
  useSettingsQuery,
} from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import type {
  ApiCapture,
  EndpointRow,
  ScanRun,
} from "@/lib/api/types";
import { formatRelative } from "@/lib/format";
import { withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

const VIEWS = [
  { id: "all", label: "All routes" },
  { id: "slow", label: "Slow checkouts" },
  { id: "errors", label: "Error hotspots" },
] as const;

type Source = "live" | "capture";

export function EndpointsPage() {
  const scope = useScope();
  const [params, setParams] = useSearchParams();
  const live = useEndpointsQuery();
  const settings = useSettingsQuery();
  const serviceName = settings.data?.project.name || scope.project;
  const {
    capture,
    running,
    failed,
    loading: captureLoading,
  } = useCapture(serviceName);
  const [view, setView] = useState<(typeof VIEWS)[number]["id"]>("all");
  const [method, setMethod] = useState("ALL");
  const [service, setService] = useState("all");
  const [minLatency, setMinLatency] = useState("0");
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "API performance · PulseOps";
  }, []);

  const liveRows = live.data ?? [];
  const requested = params.get("source");
  // Default to what exists: live traffic first, then the latest capture.
  const source: Source =
    requested === "live" || requested === "capture"
      ? requested
      : liveRows.length > 0
        ? "live"
        : capture
          ? "capture"
          : "live";
  const setSource = (next: Source) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        out.set("source", next);
        return out;
      },
      { replace: true },
    );

  const rows = source === "capture" ? (capture?.endpoints ?? []) : liveRows;
  const services = Array.from(new Set(rows.map((row) => row.service)));
  const loading = source === "live" ? live.isLoading : captureLoading;
  const baseUrl = settings.data?.scan.baseUrl ?? "";

  return (
    <div>
      <PageHeader
        eyebrow={`${scope.project} · ${scope.env}`}
        title="API performance"
        description={
          source === "capture"
            ? "Measured by opening your running app in a browser and recording the API calls it makes. A snapshot, not live traffic."
            : "Sort by percentile, hide columns, and open a route for its histogram and time split."
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SourceSwitch
          source={source}
          onChange={setSource}
          liveCount={liveRows.length}
          hasCapture={Boolean(capture)}
        />
        {source === "capture" ? (
          <CaptureAction baseUrl={baseUrl} running={running} />
        ) : null}
      </div>
      {source === "capture" ? (
        <CaptureStatus
          capture={capture}
          running={running}
          failed={failed}
          baseUrl={baseUrl}
        />
      ) : null}
      {loading ? (
        <Skeleton className="h-96" />
      ) : source === "live" && live.isError ? (
        <InlineError
          title="Could not load API performance"
          message={
            live.error instanceof Error
              ? live.error.message
              : "The API did not respond."
          }
          onRetry={() => void live.refetch()}
          pending={live.isFetching}
        />
      ) : rows.length === 0 ? (
        source === "live" ? (
          <NoLiveTraffic
            onCapture={() => setSource("capture")}
            hasCapture={Boolean(capture)}
          />
        ) : running ? null : (
          <NoCapture baseUrl={baseUrl} />
        )
      ) : (
        <>
          <FilterBar
            view={view}
            method={method}
            service={service}
            minLatency={minLatency}
            search={search}
            services={services}
            onView={(next) => {
              setView(next);
              setMethod(next === "slow" ? "POST" : "ALL");
              setSearch(next === "slow" ? "checkout" : "");
              setMinLatency(next === "slow" ? "300" : "0");
              setService("all");
            }}
            onMethod={setMethod}
            onService={setService}
            onMin={setMinLatency}
            onSearch={setSearch}
          />
          <FilteredTable
            rows={rows}
            readOnly={source === "capture"}
            view={view}
            method={method}
            service={service}
            minLatency={Number(minLatency)}
            search={search}
          />
        </>
      )}
    </div>
  );
}

function SourceSwitch({
  source,
  onChange,
  liveCount,
  hasCapture,
}: {
  source: Source;
  onChange: (next: Source) => void;
  liveCount: number;
  hasCapture: boolean;
}) {
  const items: { id: Source; label: string; hint: string }[] = [
    {
      id: "live",
      label: "Live traffic",
      hint: liveCount > 0 ? `${liveCount} routes` : "not connected",
    },
    {
      id: "capture",
      label: "App capture",
      hint: hasCapture ? "snapshot" : "none yet",
    },
  ];
  return (
    <div
      role="tablist"
      aria-label="Data source"
      className="glass inline-flex rounded-xl p-1"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={source === item.id}
          onClick={() => onChange(item.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm transition-colors",
            source === item.id
              ? "bg-white/[0.08] text-ink"
              : "text-dim hover:text-ink",
          )}
        >
          {item.label}
          <span className="ml-2 text-[11px] text-mute">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

function CaptureAction({
  baseUrl,
  running,
}: {
  baseUrl: string;
  running?: ScanRun;
}) {
  const scope = useScope();
  const client = useQueryClient();
  const start = useMutation({
    mutationFn: () => api.startScan(scope.project, "browser"),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["scans", scope.project] }),
    onError: (error: Error) => toast.error(error.message),
  });
  if (!baseUrl) {
    return (
      <Button asChild variant="secondary" size="sm">
        <Link to={withScope("/scans", scope)}>Set your app address first</Link>
      </Button>
    );
  }
  const busy = start.isPending || Boolean(running);
  return (
    <Button size="sm" onClick={() => start.mutate()} disabled={busy}>
      <Camera className="h-3.5 w-3.5" />
      {busy ? "Capturing..." : "Capture API calls"}
    </Button>
  );
}

function CaptureStatus({
  capture,
  running,
  failed,
  baseUrl,
}: {
  capture: ApiCapture | null;
  running?: ScanRun;
  failed: ScanRun | null;
  baseUrl: string;
}) {
  const scope = useScope();
  const client = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelScan(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["scans", scope.project] }),
    onError: (error: Error) => toast.error(error.message),
  });
  if (running) {
    return (
      <div className="mb-4">
        <ScanProgress
          mode={running.mode as ScanMode}
          status={running.status}
          stage={running.progress.stage}
          message={running.progress.message}
          createdAt={running.createdAt}
          cancelling={cancel.isPending}
          onCancel={() => cancel.mutate(running.id)}
        />
      </div>
    );
  }
  return (
    <>
      {failed ? (
        <div
          role="alert"
          className="mb-4 rounded-xl2 border border-danger/30 bg-danger/10 p-4 text-sm text-ink"
        >
          <p className="font-medium">The capture did not finish.</p>
          <p className="mt-1 text-dim">
            Is your app running at{" "}
            <span className="num text-ink">{baseUrl || "its base URL"}</span>?
            Start it (for example with npm run dev) and try again.
            {failed.errorSummary ? ` Details: ${failed.errorSummary}` : ""}
          </p>
        </div>
      ) : null}
      {capture?.service.capture ? (
        <p className="mb-4 text-xs text-mute">
          Captured {formatRelative(Date.parse(capture.service.capture.at))} from{" "}
          <span className="num text-dim">
            {capture.service.capture.baseUrl}
          </span>{" "}
          · {capture.service.capture.calls} calls across{" "}
          {capture.service.capture.routes} routes. p95 needs 5 samples and p99
          needs 20, otherwise they show a dash.
        </p>
      ) : null}
    </>
  );
}

function NoCapture({ baseUrl }: { baseUrl: string }) {
  return (
    <Panel
      title="No capture yet"
      description={
        baseUrl
          ? `Start your app, then press Capture API calls. PulseOps opens ${baseUrl} in a browser, visits the routes in your scan setup, and records the API calls the app makes.`
          : "Add your app's address in the scan setup on the Assets page, then come back and press Capture API calls."
      }
    >
      <p className="text-sm text-dim">
        No code changes are needed. To watch real traffic as you use the app
        instead, choose Live traffic.
      </p>
    </Panel>
  );
}

function NoLiveTraffic({
  onCapture,
  hasCapture,
}: {
  onCapture: () => void;
  hasCapture: boolean;
}) {
  const scope = useScope();
  return (
    <Panel
      title="No live traffic yet"
      description="Live traffic appears once your app reports through the PulseOps SDK. You can also measure the app without any code by capturing its API calls."
    >
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onCapture}>
          <Camera className="h-3.5 w-3.5" />
          {hasCapture ? "View app capture" : "Capture API calls"}
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link to={withScope("/settings", scope)}>
            <PlugZap className="h-3.5 w-3.5" />
            Connect live traffic
          </Link>
        </Button>
      </div>
    </Panel>
  );
}

function FilteredTable({
  rows,
  readOnly,
  view,
  method,
  service,
  minLatency,
  search,
}: {
  rows: EndpointRow[];
  readOnly: boolean;
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
      if (minLatency > 0 && !(row.p95Ms >= minLatency)) return false;
      if (view === "errors" && row.errorRate < 1) return false;
      if (!needle) return true;
      return `${row.method} ${row.route} ${row.service}`
        .toLowerCase()
        .includes(needle);
    });
  }, [method, minLatency, rows, search, service, view]);

  if (filtered.length === 0) {
    return (
      <p className="mt-6 text-sm text-dim">No routes match these filters.</p>
    );
  }
  return (
    <div className="mt-4">
      <EndpointTable rows={filtered} readOnly={readOnly} />
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
          <Button
            key={item.id}
            size="sm"
            variant={view === item.id ? "secondary" : "ghost"}
            onClick={() => onView(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div className="grid gap-2 md:grid-cols-4">
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search routes"
          aria-label="Search routes"
        />
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
