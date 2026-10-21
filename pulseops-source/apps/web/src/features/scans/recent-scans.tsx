import { useState, type ReactNode } from "react";
import { ChevronRight, History, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatRelative } from "@/lib/format";
import type { ScanRun } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const MODE_LABEL: Record<string, string> = { static: "Static", browser: "Runtime", full: "Full", vitals: "Web Vitals" };
const MODE_HELP: Record<string, string> = {
  static: "Read the repository and checked source references.",
  browser: "Opened the routes in a browser.",
  full: "Read the repository and opened the routes.",
  vitals: "Ran Lighthouse on each route. Results are on the Web Vitals page.",
};

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-success/15 text-success",
  partial: "bg-warning/15 text-warning",
  failed: "bg-danger/15 text-danger",
  running: "bg-violet/15 text-violet",
  queued: "bg-violet/15 text-violet",
  cancelled: "bg-white/5 text-dim",
};

function stamp(value: string) {
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

function duration(start: string, end: string) {
  const from = stamp(start);
  const to = stamp(end);
  if (!from || !to) return null;
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function dateTime(value: string) {
  const date = stamp(value);
  return date ? date.toLocaleString() : null;
}

/** A single button in the scan box that opens the scan history page. */
export function RecentScansPanel({
  scans,
  scopeLink,
}: {
  scans: ScanRun[];
  scopeLink: (path: string) => string;
}) {
  const latest = scans[0];
  const created = latest ? stamp(latest.createdAt) : null;
  return (
    <div className="flex h-full flex-col justify-center gap-3">
      <div>
        <h2 className="text-sm font-medium text-ink">Recent scans</h2>
        <p className="mt-1 text-xs leading-relaxed text-dim">
          Review earlier runs for this project. Each one lists its mode, status, timing and the settings it used. Open a scan to see its
          full asset report.
        </p>
      </div>
      <p className="text-xs text-mute">
        {latest
          ? `Latest: ${MODE_LABEL[latest.mode] ?? latest.mode} · ${latest.status}${created ? ` · ${formatRelative(created.getTime())}` : ""}`
          : "No scans yet. Run one to see it here."}
      </p>
      <Button asChild variant="secondary" className="w-full justify-between">
        <Link to={scopeLink("/scans/history")}>
          <span className="flex items-center gap-2">
            <History className="h-4 w-4 text-mute" aria-hidden />
            View history
            <span className="num rounded-full bg-white/5 px-2 py-0.5 text-xs font-normal text-dim">{scans.length}</span>
          </span>
          <ChevronRight className="h-4 w-4 text-mute" aria-hidden />
        </Link>
      </Button>
    </div>
  );
}

/** Full history with expandable details, used on the history page. */
export function ScanHistoryList({
  scans,
  projectName,
  scopeLink,
}: {
  scans: ScanRun[];
  projectName: string;
  scopeLink: (path: string) => string;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  if (scans.length === 0) return <p className="text-sm text-dim">No scans for this project yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {scans.map((scan) => (
        <ScanItem
          key={scan.id}
          scan={scan}
          projectName={projectName}
          expanded={open.has(scan.id)}
          onToggle={() => toggle(scan.id)}
          href={scopeLink(`/scans/${scan.id}`)}
        />
      ))}
    </ul>
  );
}

function ScanItem({
  scan,
  projectName,
  expanded,
  onToggle,
  href,
}: {
  scan: ScanRun;
  projectName: string;
  expanded: boolean;
  onToggle: () => void;
  href: string;
}) {
  const panelId = `scan-details-${scan.id}`;
  const active = scan.status === "queued" || scan.status === "running";
  const created = stamp(scan.createdAt);
  const took = duration(scan.startedAt || scan.createdAt, scan.completedAt);
  const { config } = scan;
  const viewport = config.viewportWidth && config.viewportHeight ? `${config.viewportWidth}×${config.viewportHeight}` : null;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
      >
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-mute transition-transform", expanded && "rotate-90")} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{projectName}</span>
          <span className="block text-xs text-mute">{created ? formatRelative(created.getTime()) : scan.createdAt}</span>
        </span>
        <span className="rounded-md border border-line px-2 py-0.5 text-xs text-dim">{MODE_LABEL[scan.mode] ?? scan.mode}</span>
        <StatusBadge status={scan.status} active={active} />
      </button>

      {expanded ? (
        <div id={panelId} className="mb-3 ml-8 rounded-lg border border-line bg-base/40 p-4">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Project">{projectName}</Detail>
            <Detail label="Scan mode">
              {MODE_LABEL[scan.mode] ?? scan.mode}
              {MODE_HELP[scan.mode] ? <span className="mt-0.5 block text-xs text-mute">{MODE_HELP[scan.mode]}</span> : null}
            </Detail>
            <Detail label="Status">
              <StatusBadge status={scan.status} active={active} />
            </Detail>
            <Detail label="Created">{dateTime(scan.createdAt)}</Detail>
            <Detail label="Started">{dateTime(scan.startedAt)}</Detail>
            <Detail label="Finished">{dateTime(scan.completedAt)}</Detail>
            <Detail label="Duration">{took}</Detail>
            <Detail label="Framework">{config.framework}</Detail>
            <Detail label="Viewport">{viewport}</Detail>
            <Detail label="Timeout">{config.timeoutMs ? `${config.timeoutMs} ms` : null}</Detail>
            <Detail label="Repository" wide mono>
              {config.repositoryPath}
            </Detail>
            <Detail label="Base URL" wide mono>
              {config.baseUrl}
            </Detail>
            {config.routes.length ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs text-mute">Routes ({config.routes.length})</dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {config.routes.map((route) => (
                    <span key={route} className="rounded-md border border-line px-1.5 py-0.5 font-mono text-xs text-dim">
                      {route}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            {scan.progress.message && active ? <Detail label="Current step" wide>{scan.progress.message}</Detail> : null}
            {scan.errorSummary ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-xs text-mute">{scan.status === "failed" ? "Error" : "Note"}</dt>
                <dd className={cn("mt-0.5 break-words", scan.status === "failed" ? "text-danger" : "text-dim")}>{scan.errorSummary}</dd>
              </div>
            ) : null}
            <Detail label="Scan ID" wide mono>
              {scan.id}
            </Detail>
          </dl>
          <div className="mt-4 border-t border-line pt-3">
            <Link className="text-sm text-violet hover:underline" to={href}>
              Open full report
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Detail({ label, children, wide, mono }: { label: string; children: ReactNode; wide?: boolean; mono?: boolean }) {
  if (children == null || children === "" || children === false) return null;
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2 lg:col-span-3")}>
      <dt className="text-xs text-mute">{label}</dt>
      <dd className={cn("mt-0.5 break-all text-ink", mono && "font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

function StatusBadge({ status, active }: { status: string; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLE[status] ?? "bg-white/5 text-dim",
      )}
    >
      {active ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {status}
    </span>
  );
}
