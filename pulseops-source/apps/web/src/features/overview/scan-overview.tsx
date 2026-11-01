import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PlugZap, ScanSearch } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { PageSkeleton } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/features/web-vitals/format";
import {
  useCapture,
  useScanAssetsQuery,
  useScansQuery,
  useSettingsQuery,
  useVitalsLabQuery,
} from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import type { AssetIssue } from "@/lib/api/types";
import { formatRelative } from "@/lib/format";
import { withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

const FINISHED = new Set(["completed", "partial"]);

const TYPE_COLORS: Record<string, string> = {
  image: "bg-violet",
  video: "bg-danger",
  svg: "bg-success",
  icon: "bg-success/60",
  font: "bg-warning",
  audio: "bg-warning/60",
  css: "bg-cyan",
  other: "bg-mute",
};

type Tile = { label: string; value: string; hint: string; tone?: "warning" | "danger" | "success" };

function StatTile({ tile }: { tile: Tile }) {
  return (
    <article className="glass shadow-card rounded-xl2 p-4">
      <p className="text-xs text-mute">{tile.label}</p>
      <p
        className={cn(
          "num mt-2 text-2xl font-semibold text-ink",
          tile.tone === "warning" && "text-warning",
          tile.tone === "danger" && "text-danger",
          tile.tone === "success" && "text-success",
        )}
      >
        {tile.value}
      </p>
      <p className="mt-1 text-xs text-dim">{tile.hint}</p>
    </article>
  );
}

function scoreTone(score: number | null): Tile["tone"] {
  if (score === null) return undefined;
  return score >= 90 ? "success" : score >= 50 ? "warning" : "danger";
}

/**
 * Overview for a project with no live telemetry in this environment: summarises the latest asset scan,
 * the Lighthouse audit and the API capture instead. Falls back to `empty` when nothing has been scanned.
 */
export function ScanOverview({ empty }: { empty: ReactNode }) {
  const scope = useScope();
  const scans = useScansQuery();
  const settings = useSettingsQuery();
  const lab = useVitalsLabQuery();
  const serviceName = settings.data?.project.name || scope.project;
  const { capture } = useCapture(serviceName);

  // Web Vitals audits have their own result shape and do not carry the asset report.
  const latest = scans.data?.find((scan) => FINISHED.has(scan.status) && scan.mode !== "vitals");
  const assets = useScanAssetsQuery(latest?.id ?? "", Boolean(latest));

  if (scans.isLoading || (latest && assets.isLoading)) return <PageSkeleton />;

  const labPages = (lab.data?.pages ?? []).filter((page) => page.perfScore !== null);
  const hasLab = labPages.length > 0;
  if (!latest && !hasLab && !capture) return <>{empty}</>;

  const summary = assets.data?.summary ?? null;
  const insights = summary?.insights ?? null;
  const perfScore = hasLab
    ? Math.round(labPages.reduce((total, page) => total + (page.perfScore ?? 0), 0) / labPages.length)
    : null;
  const issueCount = insights
    ? insights.large.length + insights.quality.length + insights.failed.length + insights.missing.length
    : 0;

  const tiles: Tile[] = [
    {
      label: "Assets",
      value: insights ? String(insights.totalAssets) : "—",
      hint: !summary
        ? "Run an asset scan"
        : summary.totalSizeBytes > 0
          ? `${formatBytes(summary.totalSizeBytes)} on disk`
          : "Referenced only, sizes unknown",
    },
    {
      label: "Potentially unused",
      value: insights ? String(insights.unused.length) : "—",
      hint: insights ? `${formatBytes(insights.unusedBytes)} could be removed` : "Needs an asset scan",
      tone: insights && insights.unused.length > 0 ? "warning" : undefined,
    },
    {
      label: "Duplicates",
      value: insights ? String(insights.duplicates.length) : "—",
      hint: insights ? `${formatBytes(insights.duplicateBytes)} repeated` : "Needs an asset scan",
      tone: insights && insights.duplicates.length > 0 ? "warning" : undefined,
    },
    {
      label: "Asset issues",
      value: insights ? String(issueCount) : "—",
      hint: "Large, low quality, failed or missing",
      tone: issueCount > 0 ? "danger" : insights ? "success" : undefined,
    },
    {
      label: "Lighthouse performance",
      value: perfScore === null ? "—" : String(perfScore),
      hint: hasLab ? `Average of ${labPages.length} audited ${labPages.length === 1 ? "page" : "pages"}` : "Run an audit on Web Vitals",
      tone: scoreTone(perfScore),
    },
    {
      label: "API calls captured",
      value: capture ? String(capture.service.capture?.calls ?? 0) : "—",
      hint: capture
        ? capture.endpoints.length
          ? `${capture.endpoints.length} endpoints`
          : "The app made no API calls"
        : "Capture from the API page",
    },
  ];

  const byType = Object.entries(insights?.byType ?? {}).sort(
    (a, b) => b[1].sizeBytes - a[1].sizeBytes || b[1].count - a[1].count,
  );
  // Assets the scan saw only by reference (for example fonts from a CDN) have no size, so fall back to counts.
  const bySize = byType.some(([, item]) => item.sizeBytes > 0);
  const share = (item: { count: number; sizeBytes: number }) => (bySize ? item.sizeBytes : item.count);
  const totalShare = byType.reduce((total, [, item]) => total + share(item), 0) || 1;
  const topIssues: (AssetIssue & { kind: string })[] = insights
    ? [
        ...insights.failed.map((item) => ({ ...item, kind: "Failed to load" })),
        ...insights.large.map((item) => ({ ...item, kind: "Large" })),
        ...insights.quality.map((item) => ({ ...item, kind: "Quality" })),
        ...insights.missing.map((item) => ({ ...item, kind: "Missing" })),
      ].slice(0, 6)
    : [];

  return (
    <div>
      <PageHeader
        eyebrow={`${scope.project} · ${scope.env}`}
        title="Project overview"
        description={`No live traffic in ${scope.env} yet, so this shows what the latest scans found.${
          latest ? ` Asset scan ${formatRelative(Date.parse(latest.completedAt || latest.createdAt))}.` : ""
        }`}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {tiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-12">
        <Panel
          className="xl:col-span-5"
          title="Asset mix"
          description={bySize || byType.length === 0 ? "Share of total size by type" : "Share of assets by type (sizes unknown)"}
          action={
            <Link to={withScope("/scans", scope)} className="text-xs text-cyan hover:underline">
              Asset report
            </Link>
          }
        >
          {byType.length === 0 ? (
            <p className="text-sm text-dim">No assets were found in the last scan.</p>
          ) : (
            <>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-base">
                {byType.map(([type, item]) => (
                  <span
                    key={type}
                    className={TYPE_COLORS[type] ?? "bg-mute"}
                    style={{ width: `${(share(item) / totalShare) * 100}%` }}
                  />
                ))}
              </div>
              <ul className="mt-4 space-y-2">
                {byType.map(([type, item]) => (
                  <li key={type} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-2 capitalize text-ink">
                      <span className={cn("h-2 w-2 rounded-full", TYPE_COLORS[type] ?? "bg-mute")} />
                      {type}
                    </span>
                    <span className="num text-dim">
                      {item.count} · {formatBytes(item.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <Panel className="xl:col-span-7" title="Top asset issues" description="Fix these first">
          {topIssues.length === 0 ? (
            <p className="text-sm text-dim">
              {insights ? "No large, failed, low quality or missing assets." : "Run an asset scan to see issues."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {topIssues.map((item) => (
                <li key={`${item.kind}-${item.filePath}`} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="num truncate text-xs text-ink">{item.filePath}</p>
                    <p className="mt-0.5 text-[11px] text-mute">
                      {item.kind}
                      {item.routes.length ? ` · ${item.routes.slice(0, 2).join(", ")}` : ""}
                    </p>
                  </div>
                  <span className="num shrink-0 text-xs text-dim">
                    {formatBytes(item.sizeBytes ?? item.transferBytes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel
          className="xl:col-span-12"
          title="Live charts need live traffic"
          description="Latency, throughput, errors and CPU appear here once the app reports to PulseOps from this environment."
        >
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={withScope("/settings", scope)}>
                <PlugZap className="h-3.5 w-3.5" />
                Connect live traffic
              </Link>
            </Button>
            <Button asChild size="sm" variant="secondary">
              <Link to={withScope("/scans", scope)}>
                <ScanSearch className="h-3.5 w-3.5" />
                Run a new scan
              </Link>
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
