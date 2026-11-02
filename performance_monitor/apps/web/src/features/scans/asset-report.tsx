import { useState, type ReactNode } from "react";
import { Panel } from "@/components/shared/panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AssetIssue, AssetSummary } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const PAGE = 25;

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

const KIND_LABEL: Record<string, string> = {
  low_resolution: "Low resolution",
  heavy_compression: "Heavy compression",
  oversized: "Oversized",
};

type TabId = "large" | "quality" | "failed" | "unused" | "duplicates" | "slow" | "missing" | "more";

function bytes(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ms(value: number | null) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

export function AssetReport({ summary, ready, mode }: { summary: AssetSummary | null; ready: boolean; mode?: string }) {
  const [tab, setTab] = useState<TabId>("large");
  if (!ready || !summary) {
    return <p className="text-sm text-dim">Run a scan to see asset insights.</p>;
  }
  const { insights } = summary;
  const staticRan = mode ? mode === "static" || mode === "full" : true;
  const runtimeRan = mode ? mode === "browser" || mode === "full" : true;
  const open = (next: TabId) => () => setTab(next);

  if (insights.totalAssets === 0 && insights.missing.length === 0) {
    return (
      <Panel title="Asset insights">
        <p className="text-sm text-dim">
          This scan found no assets. Check the repository path for a static scan, or the routes for a runtime scan.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Total assets"
          value={String(insights.totalAssets)}
          sub={`${bytes(summary.totalSizeBytes)} on disk${runtimeRan ? ` · ${bytes(summary.totalTransferBytes)} loaded` : ""}`}
        />
        <Kpi
          label="Potentially unused"
          value={staticRan ? String(summary.potentiallyUnused) : "—"}
          sub={staticRan ? `${bytes(insights.unusedBytes)} to review` : "Needs a static scan"}
          tone={summary.potentiallyUnused > 0 ? "warning" : "default"}
          onClick={open("unused")}
          active={tab === "unused"}
        />
        <Kpi
          label="Large images / videos"
          value={String(insights.large.length)}
          sub={insights.large.length ? `${bytes(insights.largeBytes)} combined` : "Nothing over the limit"}
          tone={insights.large.some((row) => row.severity === "high") ? "danger" : insights.large.length ? "warning" : "default"}
          onClick={open("large")}
          active={tab === "large"}
        />
        <Kpi
          label="Failed requests"
          value={runtimeRan ? String(insights.failed.length) : "—"}
          sub={runtimeRan ? "From the tested routes" : "Needs a runtime scan"}
          tone={insights.failed.length > 0 ? "danger" : "default"}
          onClick={open("failed")}
          active={tab === "failed"}
        />
        <Kpi
          label="Quality issues"
          value={String(insights.quality.length)}
          sub="Low resolution, compression, size"
          tone={insights.quality.length > 0 ? "warning" : "default"}
          onClick={open("quality")}
          active={tab === "quality"}
        />
        <Kpi
          label="Duplicates"
          value={staticRan ? String(insights.duplicates.length) : "—"}
          sub={staticRan ? `${bytes(insights.duplicateBytes)} extra copies` : "Needs a static scan"}
          tone={insights.duplicates.length > 0 ? "warning" : "default"}
          onClick={open("duplicates")}
          active={tab === "duplicates"}
        />
      </ul>

      <TypeBreakdown byType={insights.byType} />

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <div className="overflow-x-auto">
          <TabsList className="w-max">
            <TabsTrigger value="large">Large ({insights.large.length})</TabsTrigger>
            <TabsTrigger value="quality">Quality ({insights.quality.length})</TabsTrigger>
            <TabsTrigger value="failed">Failed ({insights.failed.length})</TabsTrigger>
            <TabsTrigger value="unused">Unused ({summary.potentiallyUnused})</TabsTrigger>
            <TabsTrigger value="duplicates">Duplicates ({insights.duplicates.length})</TabsTrigger>
            <TabsTrigger value="slow">Slow ({insights.slow.length})</TabsTrigger>
            {insights.missing.length ? <TabsTrigger value="missing">Broken refs ({insights.missing.length})</TabsTrigger> : null}
            <TabsTrigger value="more">More checks</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="large">
          <LargeList rows={insights.large} />
        </TabsContent>
        <TabsContent value="quality">
          <Panel
            title="Quality issues"
            description="Based on image dimensions and file size. They are hints to check. A small image can be fine as an icon or thumbnail."
          >
            <IssueList
              rows={insights.quality}
              metric="size"
              empty="No quality issues found. Dimensions come from PNG, JPEG and GIF files in a static scan."
            />
          </Panel>
        </TabsContent>
        <TabsContent value="failed">
          <Panel
            title="Failed requests"
            description="Images, media, fonts and stylesheets that did not load on a tested route, including files that do not exist in the repository."
          >
            <IssueList
              rows={insights.failed}
              metric="status"
              empty={runtimeRan ? "No asset requests failed on the tested routes." : "Run a runtime or full scan to check requests."}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="unused">
          <Panel
            title="Potentially unused"
            description="No source reference was found and no tested route requested the file. That is not proof it is unused: another route, a CMS path, or a dynamic URL may load it."
          >
            <IssueList
              rows={insights.unused}
              metric="size"
              empty={staticRan ? "Every asset is referenced or was requested." : "Run a static or full scan to find unused files."}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="duplicates">
          <Panel title="Duplicate files" description="Files that share the same SHA-256 hash.">
            <IssueList rows={insights.duplicates} metric="size" empty="No duplicate files." />
          </Panel>
        </TabsContent>
        <TabsContent value="slow">
          <Panel title="Slow downloads" description="Assets that took 1 second or more to download on a tested route.">
            <IssueList
              rows={insights.slow}
              metric="duration"
              empty={runtimeRan ? "No slow asset downloads." : "Run a runtime or full scan to measure downloads."}
            />
          </Panel>
        </TabsContent>
        <TabsContent value="missing">
          <Panel title="Broken references" description="Source files that point to a file missing from the repository.">
            <IssueList rows={insights.missing} metric="none" empty="No broken references." />
          </Panel>
        </TabsContent>
        <TabsContent value="more">
          <MoreChecks summary={summary} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone = "default",
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "warning" | "danger";
  onClick?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <p className="text-xs text-mute">{label}</p>
      <p
        className={cn(
          "num mt-1 text-2xl font-semibold",
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-ink",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-dim" title={sub}>
        {sub}
      </p>
    </>
  );
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className={cn(
            "glass shadow-card block h-full w-full rounded-xl2 p-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
            active && "ring-1 ring-violet",
          )}
        >
          {body}
        </button>
      ) : (
        <div className="glass shadow-card h-full rounded-xl2 p-3">{body}</div>
      )}
    </li>
  );
}

function TypeBreakdown({ byType }: { byType: AssetSummary["insights"]["byType"] }) {
  const entries = Object.entries(byType).sort((a, b) => b[1].sizeBytes - a[1].sizeBytes || b[1].count - a[1].count);
  const total = entries.reduce((sum, [, slot]) => sum + (slot.sizeBytes || slot.transferBytes), 0);
  if (entries.length === 0) return null;
  return (
    <Panel title="Assets by type" description="Share of total size. Runtime-only files use their transferred size.">
      {total > 0 ? (
        <div className="flex h-2.5 overflow-hidden rounded-full bg-white/5" aria-hidden>
          {entries.map(([kind, slot]) => (
            <div
              key={kind}
              className={TYPE_COLORS[kind] ?? TYPE_COLORS.other}
              style={{ width: `${((slot.sizeBytes || slot.transferBytes) / total) * 100}%` }}
            />
          ))}
        </div>
      ) : null}
      <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {entries.map(([kind, slot]) => (
          <li key={kind} className="flex items-center gap-2 text-sm">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", TYPE_COLORS[kind] ?? TYPE_COLORS.other)} />
            <span className="capitalize text-ink">{kind}</span>
            <span className="num text-dim">{slot.count}</span>
            <span className="num ml-auto text-xs text-mute">{bytes(slot.sizeBytes || slot.transferBytes)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LargeList({ rows }: { rows: AssetIssue[] }) {
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const shown = filter === "all" ? rows : rows.filter((row) => row.assetType === filter);
  const chip = (id: typeof filter, label: string, count: number) => (
    <button
      key={id}
      type="button"
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
        filter === id ? "border-violet bg-violet/10 text-ink" : "border-line text-dim hover:bg-white/5",
      )}
    >
      {label} <span className="num text-mute">{count}</span>
    </button>
  );
  return (
    <Panel
      title="Large images and videos"
      description="Images over 200 KB and videos over 1 MB, largest first. High means over 1 MB for an image or 5 MB for a video."
      action={
        <div className="flex gap-1.5">
          {chip("all", "All", rows.length)}
          {chip("image", "Images", rows.filter((row) => row.assetType === "image").length)}
          {chip("video", "Videos", rows.filter((row) => row.assetType === "video").length)}
        </div>
      }
    >
      <IssueList rows={shown} metric="size" empty="No large images or videos." />
    </Panel>
  );
}

function IssueList({
  rows,
  metric,
  empty,
}: {
  rows: AssetIssue[];
  metric: "size" | "duration" | "status" | "none";
  empty: string;
}) {
  const [count, setCount] = useState(PAGE);
  if (rows.length === 0) return <p className="text-sm text-dim">{empty}</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {rows.slice(0, count).map((row) => (
          <IssueRow key={`${row.filePath}`} row={row} metric={metric} />
        ))}
      </ul>
      {rows.length > count ? (
        <button
          type="button"
          className="mt-3 text-xs text-violet hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          onClick={() => setCount((value) => value + PAGE)}
        >
          Show {Math.min(PAGE, rows.length - count)} more of {rows.length - count}
        </button>
      ) : null}
    </>
  );
}

function IssueRow({ row, metric }: { row: AssetIssue; metric: "size" | "duration" | "status" | "none" }) {
  const dimensions = row.width && row.height ? `${row.width}×${row.height}px` : null;
  const primary =
    metric === "size"
      ? bytes(row.sizeBytes ?? row.transferBytes)
      : metric === "duration"
        ? ms(row.durationMs)
        : metric === "status"
          ? row.statusCode
            ? `HTTP ${row.statusCode}`
            : row.failureType || "failed"
          : null;
  const meta = [
    row.assetType,
    dimensions,
    metric !== "size" && row.sizeBytes != null ? bytes(row.sizeBytes) : null,
    row.transferBytes != null && row.sizeBytes != null ? `${bytes(row.transferBytes)} loaded` : null,
    metric !== "duration" && row.durationMs != null ? ms(row.durationMs) : null,
    row.inRepository ? null : "not in repository",
  ].filter(Boolean);
  return (
    <li className="py-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 break-all font-mono text-[13px] text-ink">{row.filePath}</p>
        <div className="flex shrink-0 items-center gap-2">
          {row.severity ? (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                row.severity === "high" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning",
              )}
            >
              {row.severity}
            </span>
          ) : null}
          {primary ? <span className="num text-ink">{primary}</span> : null}
        </div>
      </div>
      <p className="mt-1 text-xs text-mute">{meta.join(" · ")}</p>
      {row.kinds.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {row.kinds.map((kind) => (
            <span key={kind} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-dim">
              {KIND_LABEL[kind] ?? kind}
            </span>
          ))}
        </div>
      ) : null}
      {row.notes.map((note) => (
        <p key={note} className="mt-1 text-xs text-dim">
          {note}
        </p>
      ))}
      {row.duplicateOf ? <p className="mt-1 text-xs text-mute">Same contents as {row.duplicateOf}</p> : null}
      {row.routes.length ? <Line label="Seen on" items={row.routes} /> : null}
      {row.references.length ? <Line label="Imported by" items={row.references} /> : null}
    </li>
  );
}

function Line({ label, items }: { label: string; items: string[] }) {
  return (
    <p className="mt-1 break-all text-xs text-mute">
      {label} {items.join(", ")}
    </p>
  );
}

function MoreChecks({ summary }: { summary: AssetSummary }) {
  const block = (title: string, description: string, empty: string, rows: { key: string; body: ReactNode }[]) => (
    <Panel title={title} description={description}>
      {rows.length === 0 ? <p className="text-sm text-dim">{empty}</p> : null}
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.key} className="py-2 text-sm">
            {row.body}
          </li>
        ))}
      </ul>
    </Panel>
  );
  return (
    <div className="space-y-4">
      {block(
        "Image optimization",
        "Suggestions to check. They are not applied to the repository.",
        "No image suggestions.",
        summary.optimization.map((item) => ({
          key: item.filePath,
          body: (
            <>
              <p className="break-all font-mono text-[13px] text-ink">{item.filePath}</p>
              <p className="text-xs text-dim">{item.notes.join(" ")}</p>
            </>
          ),
        })),
      )}
      {block(
        "Lazy loading",
        "A candidate to check. The image may be the first thing on the page, so deferring it can make the page feel slower.",
        "No lazy-loading candidates.",
        summary.lazyLoading.map((item) => ({
          key: item.filePath,
          body: (
            <>
              <p className="break-all font-mono text-[13px] text-ink">{item.filePath}</p>
              <p className="text-xs text-dim">{item.note}</p>
            </>
          ),
        })),
      )}
      {block(
        "Asset location",
        "The source file that imports each asset and the routes that requested it.",
        "No references or routes recorded.",
        summary.locations.map((item) => ({
          key: item.filePath,
          body: (
            <>
              <p className="break-all font-mono text-[13px] text-ink">{item.filePath}</p>
              {item.references.length ? <p className="text-xs text-mute">Imported by {item.references.join(", ")}</p> : null}
              {item.routes.length ? <p className="text-xs text-mute">Seen on {item.routes.join(", ")}</p> : null}
            </>
          ),
        })),
      )}
    </div>
  );
}
