import { Link } from "react-router-dom";
import { Panel } from "@/components/shared/panel";
import { Sparkline } from "@/components/shared/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { useVitalsDetailQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import {
  CORE_VITALS,
  formatVital,
  type CoreVital,
  type Diagnosis,
  type LabPage,
  type LoadBreakdown,
  type VitalCell,
  type VitalFilters,
  type VitalsDetail,
} from "@/lib/api/vitals";
import { withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";
import {
  formatBytes,
  formatDuration,
  RATING_BG,
  RATING_TEXT,
} from "@/features/web-vitals/format";
import { SourceTag, VitalValue } from "@/features/web-vitals/shared";

const SPLIT_ROWS: { id: string; label: string }[] = [
  { id: "all", label: "All visits" },
  { id: "first_load", label: "First load" },
  { id: "spa_navigation", label: "Navigation inside the app" },
  { id: "mobile", label: "Mobile" },
  { id: "tablet", label: "Tablet" },
  { id: "desktop", label: "Desktop" },
];

const SEVERITY_BG: Record<Diagnosis["severity"], string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-cyan",
};

export function RouteDetail({
  route,
  filters,
}: {
  route: string | null;
  filters: VitalFilters;
}) {
  const query = useVitalsDetailQuery(route, filters);
  if (!route) return null;
  if (query.isLoading || !query.data) return <Skeleton className="h-72" />;
  const detail = query.data;
  return (
    <section aria-label={`Diagnosis for ${route}`} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-ink">
          Route diagnosis
        </h2>
        <code className="num rounded-md bg-white/[0.05] px-2 py-0.5 text-xs text-ink">
          {route}
        </code>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <FieldColumn detail={detail} />
        <LabColumn detail={detail} />
      </div>
    </section>
  );
}

function FieldColumn({ detail }: { detail: VitalsDetail }) {
  const { summary, distribution, trend, load } = detail.field;
  const splitCell = (id: string, metric: CoreVital): VitalCell | null => {
    if (id === "all") return summary.metrics[metric] ?? null;
    return summary.splits[id]?.[metric] ?? null;
  };
  const lcpTrend = trend.flatMap((point) =>
    point.LCP === null ? [] : [point.LCP],
  );
  return (
    <Panel
      title="Real users"
      description="75th percentile from real visits. Splits show where the slowness is."
      action={<SourceTag kind="field" />}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-mute">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Segment</th>
              {CORE_VITALS.map((metric) => (
                <th key={metric} className="py-1.5 pr-3 text-right font-medium">
                  {metric}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPLIT_ROWS.map((row) => {
              const cells = CORE_VITALS.map((metric) =>
                splitCell(row.id, metric),
              );
              if (row.id !== "all" && cells.every((cell) => cell === null))
                return null;
              return (
                <tr key={row.id} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-dim">{row.label}</td>
                  {CORE_VITALS.map((metric, index) => (
                    <td
                      key={metric}
                      className="py-1.5 pr-3 text-right"
                      title={`${cells[index]?.samples ?? 0} samples`}
                    >
                      <VitalValue
                        metric={metric}
                        value={cells[index]?.p75 ?? null}
                        rating={cells[index]?.rating ?? null}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {lcpTrend.length > 1 ? (
        <div className="mt-5">
          <p className="mb-1 text-[11px] uppercase tracking-[0.14em] text-mute">
            LCP p75 over time
          </p>
          <Sparkline data={lcpTrend} color="#22D3EE" />
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {distribution.map((entry) => (
          <Distribution key={entry.metric} entry={entry} />
        ))}
      </div>

      <div className="mt-5">
        <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-mute">
          Page load, first load vs navigation inside the app
        </p>
        <LoadTable first={load.first_load} soft={load.spa_navigation} />
      </div>
    </Panel>
  );
}

function Distribution({
  entry,
}: {
  entry: VitalsDetail["field"]["distribution"][number];
}) {
  const max = Math.max(1, ...entry.bins.map((bin) => bin.count));
  const total = entry.bins.reduce((sum, bin) => sum + bin.count, 0);
  return (
    <figure>
      <figcaption className="mb-1 text-[11px] text-mute">
        {entry.metric} distribution · {total.toLocaleString()} samples
      </figcaption>
      <div
        className="flex h-14 items-end gap-px"
        role="img"
        aria-label={`${entry.metric} histogram`}
      >
        {entry.bins.map((bin) => (
          <div
            key={bin.from}
            className={cn(
              "flex-1 rounded-t-sm opacity-80",
              bin.rating ? RATING_BG[bin.rating] : "bg-mute",
            )}
            style={{
              height: `${Math.max(bin.count > 0 ? 6 : 0, (bin.count / max) * 100)}%`,
            }}
            title={`${formatVital(entry.metric, bin.from)} to ${formatVital(entry.metric, bin.to)}: ${bin.count}`}
          />
        ))}
      </div>
      <div className="num mt-1 flex justify-between text-[10px] text-mute">
        <span>0</span>
        <span>{formatVital(entry.metric, entry.cap)}+</span>
      </div>
    </figure>
  );
}

function LoadTable({
  first,
  soft,
}: {
  first: LoadBreakdown;
  soft: LoadBreakdown;
}) {
  const rows: { label: string; pick: (load: LoadBreakdown) => string }[] = [
    { label: "Visits", pick: (load) => load.pageViews.toLocaleString() },
    {
      label: "Time to first byte",
      pick: (load) => formatDuration(load.ttfbMs),
    },
    {
      label: "DOM content loaded",
      pick: (load) => formatDuration(load.domContentLoadedMs),
    },
    { label: "Load time", pick: (load) => formatDuration(load.loadMs) },
    { label: "Transferred", pick: (load) => formatBytes(load.transferBytes) },
    {
      label: "JavaScript transferred",
      pick: (load) => formatBytes(load.jsBytes),
    },
    {
      label: "Requests",
      pick: (load) =>
        load.resourceCount === null
          ? "—"
          : String(Math.round(load.resourceCount)),
    },
    {
      label: "Long tasks",
      pick: (load) =>
        load.longTaskCount === null
          ? "—"
          : `${Math.round(load.longTaskCount)} · ${formatDuration(load.longTaskMs)}`,
    },
    { label: "Blocking time", pick: (load) => formatDuration(load.tbtMs) },
  ];
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-mute">
        <tr>
          <th className="py-1.5 pr-3 font-medium">p75</th>
          <th className="py-1.5 pr-3 text-right font-medium">First load</th>
          <th className="py-1.5 pr-3 text-right font-medium">Navigation</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-line">
            <td className="py-1.5 pr-3 text-dim">{row.label}</td>
            <td className="num py-1.5 pr-3 text-right text-ink">
              {row.pick(first)}
            </td>
            <td className="num py-1.5 pr-3 text-right text-ink">
              {row.pick(soft)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LabColumn({ detail }: { detail: VitalsDetail }) {
  const scope = useScope();
  const { pages, scan } = detail.lab;
  const field = detail.field.summary.metrics;
  return (
    <Panel
      title="Suspected contributors"
      description="Found by a synthetic Lighthouse test. It can reproduce a bottleneck, but it is not what your users measured."
      action={<SourceTag kind="lab" />}
    >
      <p className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
        <span>Field p75 for comparison:</span>
        {CORE_VITALS.map((metric) => (
          <span key={metric}>
            {metric}{" "}
            <VitalValue
              metric={metric}
              value={field[metric]?.p75 ?? null}
              rating={field[metric]?.rating ?? null}
            />
          </span>
        ))}
      </p>
      {pages.length === 0 ? (
        <div className="space-y-2 text-sm text-dim">
          <p>No lab audit covers this route yet.</p>
          <Link
            to={withScope("/vitals?tab=lab", scope)}
            className="text-violet underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            Run a Web Vitals audit
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          {[...pages]
            .sort((a, b) =>
              a.formFactor === b.formFactor
                ? 0
                : a.formFactor === "mobile"
                  ? -1
                  : 1,
            )
            .map((page) => (
              <LabSection key={page.formFactor} page={page} />
            ))}
          {scan ? (
            <p className="text-[11px] text-mute">
              From the audit run{" "}
              {scan.completedAt
                ? new Date(scan.completedAt).toLocaleString()
                : "recently"}
              .
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function LabSection({ page }: { page: LabPage }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
        <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 font-medium capitalize text-ink">
          {page.formFactor}
        </span>
        {page.status === "failed" ? (
          <span className="text-danger">
            {page.errorSummary || "The audit failed for this route."}
          </span>
        ) : (
          <>
            <span className="text-mute">
              Score{" "}
              <span
                className={cn(
                  "num",
                  page.perfScore !== null && page.perfScore >= 90
                    ? "text-success"
                    : page.perfScore !== null && page.perfScore >= 50
                      ? "text-warning"
                      : "text-danger",
                )}
              >
                {page.perfScore ?? "—"}
              </span>
            </span>
            <span className="text-mute">
              LCP{" "}
              <span className="num text-ink">
                {formatVital("LCP", page.lcpMs)}
              </span>
            </span>
            <span className="text-mute">
              TBT{" "}
              <span className="num text-ink">{formatDuration(page.tbtMs)}</span>
            </span>
            <span className="text-mute">
              CLS{" "}
              <span className="num text-ink">
                {formatVital("CLS", page.cls)}
              </span>
            </span>
          </>
        )}
      </div>
      {page.status !== "failed" && page.diagnosis.length === 0 ? (
        <p className="text-sm text-dim">
          No rule fired. Nothing obvious is slowing this route in the lab.
        </p>
      ) : (
        <ul className="space-y-2">
          {page.diagnosis.map((item) => (
            <li
              key={item.id}
              className="rounded-xl2 border border-line bg-white/[0.02] p-3"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-ink">
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    SEVERITY_BG[item.severity],
                  )}
                  aria-hidden
                />
                {item.title}
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wide",
                    item.severity === "high" ? RATING_TEXT.poor : "text-mute",
                  )}
                >
                  {item.severity}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-dim">{item.evidence}</p>
              <p className="mt-1 text-xs leading-5 text-mute">{item.action}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
