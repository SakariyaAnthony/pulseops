import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useScanApisQuery,
  useScanAssetsQuery,
  useScanPagesQuery,
  useScansQuery,
  useSettingsQuery,
} from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import type { ScanEndpoint, ScanPage, ScanSetup } from "@/lib/api/types";
import { withScope } from "@/lib/scope";
import { AssetReport } from "@/features/scans/asset-report";
import {
  ScanModePicker,
  type ScanMode,
} from "@/features/scans/scan-mode-picker";
import { RecentScansPanel } from "@/features/scans/recent-scans";
import { ScanProgress } from "@/features/scans/scan-progress";
import {
  ScanSetupSheet,
  type CreatedProject,
  type SaveTarget,
} from "@/features/scans/scan-setup-sheet";
import { ConnectDialog } from "@/features/settings/connect-snippet";

const FINISHED = new Set(["completed", "partial", "failed"]);

export function ScansPage() {
  const scope = useScope();
  const query = useScansQuery();
  const settings = useSettingsQuery();
  const client = useQueryClient();

  useEffect(() => {
    document.title = "Asset Intelligence Scanner · PulseOps";
  }, []);

  const [mode, setMode] = useState<ScanMode>("full");

  // "+ New project" in the top bar links here with ?setup=new to open the setup sheet on the New project choice.
  const [params] = useSearchParams();
  const wantsNew = params.get("setup") === "new";
  const [manualOpen, setManualOpen] = useState(false);
  const setupOpen = wantsNew || manualOpen;
  const initialTarget: SaveTarget = wantsNew ? "new" : "current";
  const onSetupOpenChange = (next: boolean) => {
    setManualOpen(next);
    if (!next && wantsNew) scope.update({ setup: null });
  };
  const [created, setCreated] = useState<CreatedProject | null>(null);
  const onCreated = (project: CreatedProject) => {
    setManualOpen(false);
    scope.update({ project: project.slug, setup: null });
    // The key is only shown once, so offer it right away. Skipping is fine: Capture API calls needs no key.
    if (project.apiKey) setCreated(project);
  };

  const start = useMutation({
    mutationFn: (mode: ScanMode) => api.startScan(scope.project, mode),
    onSuccess: async (scan) => {
      await client.invalidateQueries({ queryKey: ["scans", scope.project] });
      if (scan && scan.status !== "queued" && scan.status !== "running")
        toast.success(`Scan ${scan.status}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelScan(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["scans", scope.project] });
      toast.success("Scan cancelled");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <>
      <QueryGate query={query} skeleton={<Skeleton className="h-80" />}>
        {(scans) => {
          const running = scans.find(
            (scan) => scan.status === "queued" || scan.status === "running",
          );
          // Web Vitals audits have their own page and must not replace the asset results shown here.
          const finished = scans.find(
            (scan) => FINISHED.has(scan.status) && scan.mode !== "vitals",
          );
          return (
            <div className="space-y-4">
              <PageHeader
                eyebrow={scope.project}
                title="Asset Intelligence Scanner"
                description="Static scan reads the repository. Runtime scan opens the routes you list. An asset missed by one pass stays potentially unused."
              />
              {settings.data ? (
                <>
                  <SetupSummary
                    project={scope.project}
                    projectName={settings.data.project.name || scope.project}
                    scan={settings.data.scan}
                    open={setupOpen}
                    onOpenChange={onSetupOpenChange}
                    initialTarget={initialTarget}
                    onCreated={onCreated}
                  />
                  <ScanModePicker
                    scan={settings.data.scan}
                    value={mode}
                    onChange={setMode}
                    busy={start.isPending || Boolean(running)}
                    onRun={() => start.mutate(mode)}
                    aside={
                      <RecentScansPanel
                        scans={scans}
                        scopeLink={(path) => withScope(path, scope)}
                      />
                    }
                  />
                </>
              ) : null}
              {running || start.isPending ? (
                <ScanProgress
                  mode={running?.mode ?? mode}
                  status={running?.status ?? "queued"}
                  stage={running?.progress.stage}
                  message={running?.progress.message}
                  createdAt={running?.createdAt}
                  cancelling={cancel.isPending}
                  onCancel={
                    running ? () => cancel.mutate(running.id) : undefined
                  }
                />
              ) : null}
              {running || start.isPending ? null : (
                <FinishedScan id={finished?.id ?? ""} mode={finished?.mode} />
              )}
            </div>
          );
        }}
      </QueryGate>
      {created ? (
        <ConnectDialog
          open
          onOpenChange={(open) => !open && setCreated(null)}
          title={`${created.name} is ready`}
          description="Capture API calls works without any code in your app. To also see live traffic, add this snippet. The key is shown only once, so copy it now. You can generate a new one later in Settings."
          serviceName={created.name}
          apiKey={created.apiKey}
        />
      ) : null}
    </>
  );
}

function FinishedScan({ id, mode }: { id: string; mode?: string }) {
  const ready = Boolean(id);
  const assets = useScanAssetsQuery(id, ready);
  const apis = useScanApisQuery(id, ready);
  const pages = useScanPagesQuery(id, ready);
  return (
    <>
      <AssetReport
        summary={assets.data?.summary ?? null}
        ready={ready && !assets.isLoading}
        mode={mode}
      />
      <Panel
        title="API"
        description="Calls observed while the runtime scan opened the routes. p95 needs 5 samples and p99 needs 20."
      >
        <ApiTable rows={apis.data?.endpoints ?? []} />
      </Panel>
      <Panel
        title="Pages"
        description="Lab measurements from the runtime scan, separate from SDK field data."
      >
        <PageTable rows={pages.data ?? []} />
      </Panel>
    </>
  );
}

function SetupSummary({
  project,
  projectName,
  scan,
  open,
  onOpenChange,
  initialTarget,
  onCreated,
}: {
  project: string;
  projectName: string;
  scan: ScanSetup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTarget: SaveTarget;
  onCreated: (created: CreatedProject) => void;
}) {
  const item = (label: string, value: string, empty: string) => (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-[0.16em] text-mute">
        {label}
      </p>
      <p
        className={`truncate text-sm ${value ? "text-ink" : "text-warning"}`}
        title={value || undefined}
      >
        {value || empty}
      </p>
    </div>
  );
  const routes = scan.routes.filter((route) => route.trim());
  return (
    <div className="glass shadow-card flex flex-wrap items-center justify-between gap-4 rounded-xl2 px-4 py-3">
      <div className="grid min-w-0 flex-1 gap-x-6 gap-y-2 sm:grid-cols-3">
        {item("Repository", scan.repositoryPath, "Not set")}
        {item("Base URL", scan.baseUrl, "Not set")}
        {item(
          "Routes",
          routes.length
            ? `${routes.length} · ${routes.slice(0, 3).join(", ")}${routes.length > 3 ? "…" : ""}`
            : "",
          "Defaults to /",
        )}
      </div>
      <ScanSetupSheet
        project={project}
        projectName={projectName}
        scan={scan}
        open={open}
        onOpenChange={onOpenChange}
        initialTarget={initialTarget}
        onCreated={onCreated}
      />
    </div>
  );
}

function ApiTable({ rows }: { rows: ScanEndpoint[] }) {
  if (rows.length === 0)
    return <p className="text-sm text-dim">No API calls captured.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li
          key={`${row.method} ${row.endpointTemplate}`}
          className="flex justify-between gap-3 py-2 text-sm"
        >
          <span className="text-ink">
            {row.method} {row.endpointTemplate}
          </span>
          <span className="num text-dim">
            {row.count} · median{" "}
            {row.medianMs == null ? "—" : `${Math.round(row.medianMs)} ms`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PageTable({ rows }: { rows: ScanPage[] }) {
  if (rows.length === 0)
    return <p className="text-sm text-dim">No pages recorded.</p>;
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
