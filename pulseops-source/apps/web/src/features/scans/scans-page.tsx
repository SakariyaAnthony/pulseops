import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanApisQuery, useScanAssetsQuery, useScanPagesQuery, useScansQuery, useSettingsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import type { ScanEndpoint, ScanPage, ScanSetup } from "@/lib/api/types";
import { withScope } from "@/lib/scope";
import { AssetReport } from "@/features/scans/asset-report";

const MODES = [
  { id: "static", label: "Static" },
  { id: "browser", label: "Runtime" },
  { id: "full", label: "Full" },
] as const;

const FINISHED = new Set(["completed", "partial", "failed"]);

export function ScansPage() {
  const scope = useScope();
  const query = useScansQuery();
  const settings = useSettingsQuery();
  const client = useQueryClient();

  useEffect(() => {
    document.title = "Asset Intelligence Scanner · PulseOps";
  }, []);

  const start = useMutation({
    mutationFn: (mode: (typeof MODES)[number]["id"]) => api.startScan(scope.project, mode),
    onSuccess: async (scan) => {
      await client.invalidateQueries({ queryKey: ["scans", scope.project] });
      if (scan) toast.success(`Scan ${scan.status}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <QueryGate query={query} skeleton={<Skeleton className="h-80" />}>
      {(scans) => {
        const running = scans.find((scan) => scan.status === "queued" || scan.status === "running");
        const finished = scans.find((scan) => FINISHED.has(scan.status));
        return (
          <div className="space-y-4">
            <PageHeader
              eyebrow={scope.project}
              title="Asset Intelligence Scanner"
              description="Static scan reads the repository. Runtime scan opens the routes you list. An asset missed by one pass stays potentially unused."
            />
            {settings.data ? <ScanSetupForm project={scope.project} scan={settings.data.scan} /> : null}
            <div className="flex flex-wrap gap-2">
              {MODES.map((mode) => (
                <Button key={mode.id} size="sm" variant="secondary" disabled={start.isPending} onClick={() => start.mutate(mode.id)}>
                  {mode.label}
                </Button>
              ))}
            </div>
            {running ? (
              <p className="text-sm text-dim">
                {running.mode} scan is {running.status}. {running.progress.message}
              </p>
            ) : null}
            <FinishedScan id={finished?.id ?? ""} />
            <Panel title="Recent scans">
              {scans.length === 0 ? <p className="text-sm text-dim">No scans for this project yet.</p> : null}
              <ul className="divide-y divide-line">
                {scans.map((scan) => (
                  <li key={scan.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link className="text-ink hover:text-violet" to={withScope(`/scans/${scan.id}`, scope)}>
                      {scan.mode} · {scan.status}
                    </Link>
                    <span className="text-xs text-mute">{scan.errorSummary || scan.createdAt}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        );
      }}
    </QueryGate>
  );
}

function FinishedScan({ id }: { id: string }) {
  const ready = Boolean(id);
  const assets = useScanAssetsQuery(id, ready);
  const apis = useScanApisQuery(id, ready);
  const pages = useScanPagesQuery(id, ready);
  return (
    <>
      <AssetReport summary={assets.data?.summary ?? null} ready={ready && !assets.isLoading} />
      <Panel title="API" description="Calls observed while the runtime scan opened the routes. p95 needs 5 samples and p99 needs 20.">
        <ApiTable rows={apis.data?.endpoints ?? []} />
      </Panel>
      <Panel title="Pages" description="Lab measurements from the runtime scan, separate from SDK field data.">
        <PageTable rows={pages.data ?? []} />
      </Panel>
    </>
  );
}

function ScanSetupForm({ project, scan }: { project: string; scan: ScanSetup }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(scan);
  useEffect(() => {
    setDraft(scan);
  }, [scan]);
  const save = useMutation({
    mutationFn: () =>
      api.saveScanConfig(project, {
        ...draft,
        routes: draft.routes.map((route) => route.trim()).filter(Boolean),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["settings", project] });
      toast.success("Scan settings saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const field = (label: string, value: string, onChange: (value: string) => void, placeholder?: string) => (
    <label className="block text-sm">
      <span className="text-dim">{label}</span>
      <Input className="mt-1" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
  return (
    <Panel
      title="Scan setup"
      description="The start command is stored and not run. The repository must be inside your home directory."
      action={
        <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="space-y-3">
        {field("Repository path", draft.repositoryPath, (repositoryPath) => setDraft({ ...draft, repositoryPath }), "/absolute/path/to/app")}
        {field("Base URL", draft.baseUrl, (baseUrl) => setDraft({ ...draft, baseUrl }), "http://127.0.0.1:5173")}
        <label className="block text-sm">
          <span className="text-dim">Routes</span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border border-line bg-base/70 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-violet"
            value={draft.routes.join("\n")}
            onChange={(event) => setDraft({ ...draft, routes: event.target.value.split("\n") })}
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          {field("Width", String(draft.viewportWidth), (value) => setDraft({ ...draft, viewportWidth: Number(value) || 1280 }))}
          {field("Height", String(draft.viewportHeight), (value) => setDraft({ ...draft, viewportHeight: Number(value) || 720 }))}
          {field("Timeout ms", String(draft.timeoutMs), (value) => setDraft({ ...draft, timeoutMs: Number(value) || 15000 }))}
        </div>
        {field("Start command", draft.startCommand, (startCommand) => setDraft({ ...draft, startCommand }), "npm run dev")}
        {draft.framework ? <p className="text-xs text-mute">Detected framework: {draft.framework}</p> : null}
      </div>
    </Panel>
  );
}

function ApiTable({ rows }: { rows: ScanEndpoint[] }) {
  if (rows.length === 0) return <p className="text-sm text-dim">No API calls captured.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li key={`${row.method} ${row.endpointTemplate}`} className="flex justify-between gap-3 py-2 text-sm">
          <span className="text-ink">
            {row.method} {row.endpointTemplate}
          </span>
          <span className="num text-dim">
            {row.count} · median {row.medianMs == null ? "—" : `${Math.round(row.medianMs)} ms`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PageTable({ rows }: { rows: ScanPage[] }) {
  if (rows.length === 0) return <p className="text-sm text-dim">No pages recorded.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((page) => (
        <li key={page.route} className="py-2 text-sm text-ink">
          {page.route} · {page.status} · {page.metricSource}
        </li>
      ))}
    </ul>
  );
}
