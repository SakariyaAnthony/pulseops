import { Panel } from "@/components/shared/panel";
import type { AssetSummary } from "@/lib/api/types";

const KINDS = ["image", "svg", "video", "audio", "font", "icon", "css", "other"] as const;

function bytes(value: number | null | undefined) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ms(value: number | null) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

export function AssetReport({ summary, ready }: { summary: AssetSummary | null; ready: boolean }) {
  if (!ready || !summary) {
    return <p className="text-sm text-dim">Run a static or runtime scan to fill these sections.</p>;
  }
  return (
    <div className="space-y-4">
      <Panel title="Asset inventory" description="Files found in the repository. Icons are .ico files and SVGs inside an icon folder.">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KINDS.map((kind) => (
            <li key={kind} className="rounded-lg border border-line px-3 py-2">
              <p className="text-xs uppercase tracking-wide text-mute">{kind}</p>
              <p className="num text-lg text-ink">{summary.counts[kind] ?? 0}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Usage detection" description="Potentially unused means this scan did not see a reference or a request. A lazy route, conditional screen, CMS path, or dynamic URL can still load the file.">
        <ul className="grid gap-2 sm:grid-cols-3">
          <Count label="Referenced" value={summary.referenced} />
          <Count label="Potentially unused" value={summary.potentiallyUnused} />
          <Count label="Missing reference" value={summary.missingReference} />
        </ul>
      </Panel>
      <Panel title="File size" description="Disk size comes from the static scan. Transferred bytes come from the runtime scan.">
        <p className="text-sm text-ink">
          On disk {bytes(summary.totalSizeBytes)} · transferred {bytes(summary.totalTransferBytes)}
        </p>
        {summary.largest.length === 0 ? <p className="mt-2 text-sm text-dim">No file sizes recorded.</p> : null}
        <ul className="mt-2 divide-y divide-line">
          {summary.largest.map((item) => (
            <li key={item.filePath} className="flex justify-between gap-3 py-2 text-sm">
              <span className="text-ink">{item.filePath}</span>
              <span className="num text-dim">{bytes(item.fileSizeBytes)}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Load performance" description="Download duration, transfer size, and failed image, font, or media requests from the runtime pass.">
        {summary.loadPerformance.length === 0 ? <p className="text-sm text-dim">No runtime asset loads in this scan.</p> : null}
        <ul className="divide-y divide-line">
          {summary.loadPerformance.map((item) => (
            <li key={item.filePath} className="py-2 text-sm">
              <p className="text-ink">{item.filePath}</p>
              <p className="text-xs text-mute">
                {ms(item.durationMs)} · {bytes(item.transferBytes)}
                {item.failureType ? ` · ${item.failureType}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Duplicate detection" description="Files that share a SHA-256 hash.">
        {summary.duplicates.length === 0 ? <p className="text-sm text-dim">No duplicate hashes.</p> : null}
        <ul className="divide-y divide-line">
          {summary.duplicates.map((item) => (
            <li key={item.filePath} className="py-2 text-sm text-ink">
              {item.filePath} <span className="text-mute">matches {item.duplicateOf}</span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Image optimization" description="Suggestions to check. They are not applied to the repository.">
        {summary.optimization.length === 0 ? <p className="text-sm text-dim">No image suggestions.</p> : null}
        <ul className="divide-y divide-line">
          {summary.optimization.map((item) => (
            <li key={item.filePath} className="py-2 text-sm">
              <p className="text-ink">{item.filePath}</p>
              <p className="text-xs text-dim">{item.notes.join(" ")}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Lazy loading" description="A candidate to check. The image may be the first thing on the page, so deferring it can make the page feel slower.">
        {summary.lazyLoading.length === 0 ? <p className="text-sm text-dim">No lazy-loading candidates.</p> : null}
        <ul className="divide-y divide-line">
          {summary.lazyLoading.map((item) => (
            <li key={item.filePath} className="py-2 text-sm">
              <p className="text-ink">{item.filePath}</p>
              <p className="text-xs text-dim">{item.note}</p>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Asset location" description="File path, the source file that imports it, and the routes that requested it.">
        {summary.locations.length === 0 ? <p className="text-sm text-dim">No references or routes recorded.</p> : null}
        <ul className="divide-y divide-line">
          {summary.locations.map((item) => (
            <li key={item.filePath} className="py-2 text-sm">
              <p className="text-ink">{item.filePath}</p>
              {item.references.length ? <p className="text-xs text-mute">Imported by {item.references.join(", ")}</p> : null}
              {item.routes.length ? <p className="text-xs text-mute">Seen on {item.routes.join(", ")}</p> : null}
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <li className="rounded-lg border border-line px-3 py-2">
      <p className="text-xs text-mute">{label}</p>
      <p className="num text-lg text-ink">{value}</p>
    </li>
  );
}
