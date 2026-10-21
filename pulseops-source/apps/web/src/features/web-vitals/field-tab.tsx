import { Panel } from "@/components/shared/panel";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CORE_VITALS,
  THRESHOLDS,
  type VitalCard,
  type VitalFilters,
  type VitalMetric,
  type VitalRoute,
  type VitalsRoutes,
  type VitalsSummary,
} from "@/lib/api/vitals";
import { cn } from "@/lib/utils";
import { RouteDetail } from "@/features/web-vitals/route-detail";
import {
  RATING_BG,
  RATING_LABEL,
  RATING_TEXT,
  thresholdText,
} from "@/features/web-vitals/format";
import {
  RatingDot,
  SourceBanner,
  VitalValue,
} from "@/features/web-vitals/shared";

const TITLES: Record<VitalMetric, string> = {
  LCP: "Largest Contentful Paint",
  INP: "Interaction to Next Paint",
  CLS: "Cumulative Layout Shift",
  FCP: "First Contentful Paint",
  TTFB: "Time to First Byte",
};

export function FieldTab({
  summary,
  routes,
  filters,
  selected,
  onSelect,
  loading,
}: {
  summary?: VitalsSummary;
  routes?: VitalsRoutes;
  filters: VitalFilters;
  selected: string | null;
  onSelect: (route: string) => void;
  loading: boolean;
}) {
  if (loading || !summary || !routes) return <Skeleton className="h-96" />;
  const empty = summary.pageViews === 0 && routes.routes.length === 0;
  return (
    <div className="space-y-4">
      <SourceBanner kind="field">
        Field data comes from real visits reported by the PulseOps browser SDK.
        Each number is the 75th percentile: three of four visits were at least
        this fast. It is shown only after {summary.minSamples} samples.
      </SourceBanner>
      {empty ? (
        <NoFieldData />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {summary.metrics
              .filter((card) =>
                (CORE_VITALS as readonly string[]).includes(card.metric),
              )
              .map((card) => (
                <CoreCard
                  key={card.metric}
                  card={card}
                  minSamples={summary.minSamples}
                />
              ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {summary.metrics
              .filter(
                (card) =>
                  !(CORE_VITALS as readonly string[]).includes(card.metric),
              )
              .map((card) => (
                <SupportCard key={card.metric} card={card} />
              ))}
          </div>
          <PerformanceByPage
            routes={routes.routes}
            selected={selected}
            onSelect={onSelect}
          />
          <RoutesTable
            routes={routes}
            selected={selected}
            onSelect={onSelect}
          />
          <RouteDetail route={selected} filters={filters} />
        </>
      )}
    </div>
  );
}

function NoFieldData() {
  return (
    <Panel title="No real-user data yet">
      <div className="space-y-3 text-sm leading-6 text-dim">
        <p>
          Nothing has been reported by browsers for this project and range. Add
          the browser SDK to your app, then open a few pages. Web vitals are
          collected automatically.
        </p>
        <pre className="num overflow-x-auto rounded-xl2 border border-line bg-base/80 p-3 text-xs leading-5 text-dim">
          {`npm install @pulseops/browser web-vitals

PulseOps.init({ apiKey, service: "web", env: "prod" });`}
        </pre>
        <p className="text-xs text-mute">
          The Settings page shows a snippet with your key. Use the Lab tab to
          measure routes without any SDK.
        </p>
      </div>
    </Panel>
  );
}

function CoreCard({
  card,
  minSamples,
}: {
  card: VitalCard;
  minSamples: number;
}) {
  const known =
    card.goodPct !== null && card.improvePct !== null && card.poorPct !== null;
  return (
    <section className="glass shadow-card rounded-xl2 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold tracking-wide text-ink">
            {card.metric}
          </p>
          <p className="text-[11px] text-mute">{TITLES[card.metric]}</p>
        </div>
        {card.rating ? (
          <span
            className={cn("text-[11px] font-medium", RATING_TEXT[card.rating])}
          >
            {RATING_LABEL[card.rating]}
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight">
        <VitalValue
          metric={card.metric}
          value={card.p75}
          rating={card.rating}
        />
      </p>
      <p className="mt-1 text-[11px] text-mute">
        {card.p75 === null
          ? `Needs ${minSamples} samples · have ${card.samples}`
          : `p75 · ${card.samples.toLocaleString()} samples`}
      </p>
      {known ? (
        <div
          className="mt-4"
          aria-label={`${card.goodPct}% good, ${card.improvePct}% needs improvement, ${card.poorPct}% poor`}
        >
          <div className="flex h-2 overflow-hidden rounded-full bg-white/5">
            <div
              className={RATING_BG.good}
              style={{ width: `${card.goodPct}%` }}
            />
            <div
              className={RATING_BG["needs-improvement"]}
              style={{ width: `${card.improvePct}%` }}
            />
            <div
              className={RATING_BG.poor}
              style={{ width: `${card.poorPct}%` }}
            />
          </div>
          <p className="num mt-1.5 text-[11px] text-mute">
            {card.goodPct}% good · {card.improvePct}% needs work ·{" "}
            {card.poorPct}% poor
          </p>
        </div>
      ) : null}
      <p className="mt-3 text-[11px] text-mute">{thresholdText(card.metric)}</p>
    </section>
  );
}

function SupportCard({ card }: { card: VitalCard }) {
  return (
    <section className="glass shadow-card flex items-center justify-between gap-3 rounded-xl2 px-5 py-4">
      <div>
        <p className="text-xs font-semibold text-ink">{card.metric}</p>
        <p className="text-[11px] text-mute">{TITLES[card.metric]}</p>
      </div>
      <div className="text-right">
        <p className="text-xl font-semibold">
          <VitalValue
            metric={card.metric}
            value={card.p75}
            rating={card.rating}
          />
        </p>
        <p className="text-[11px] text-mute">
          {card.samples.toLocaleString()} samples
        </p>
      </div>
    </section>
  );
}

/** LCP p75 per route against the good and poor limits. */
function PerformanceByPage({
  routes,
  selected,
  onSelect,
}: {
  routes: VitalRoute[];
  selected: string | null;
  onSelect: (route: string) => void;
}) {
  const rows = routes.filter((route) => route.metrics.LCP.p75 !== null);
  if (rows.length === 0) return null;
  const t = THRESHOLDS.LCP;
  const max = Math.max(
    t.poor * 1.25,
    ...rows.map((route) => route.metrics.LCP.p75 ?? 0),
  );
  const pct = (value: number) => `${Math.min(100, (value / max) * 100)}%`;
  return (
    <Panel
      title="Performance by page"
      description="Largest Contentful Paint, 75th percentile. Markers show the good and poor limits."
    >
      <ul className="space-y-3">
        {rows.map((route) => {
          const cell = route.metrics.LCP;
          return (
            <li key={route.route}>
              <button
                type="button"
                onClick={() => onSelect(route.route)}
                className={cn(
                  "grid w-full grid-cols-[minmax(7rem,12rem)_1fr_5rem] items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
                  selected === route.route && "bg-white/[0.05]",
                )}
              >
                <span className="truncate text-sm text-ink" title={route.route}>
                  {route.route}
                </span>
                <span className="relative h-2.5 rounded-full bg-white/5">
                  <span
                    className={cn(
                      "absolute inset-y-0 left-0 rounded-full",
                      cell.rating ? RATING_BG[cell.rating] : "bg-mute",
                    )}
                    style={{ width: pct(cell.p75 ?? 0) }}
                  />
                  <span
                    className="absolute -inset-y-1 w-px bg-white/30"
                    style={{ left: pct(t.good) }}
                    aria-hidden
                  />
                  <span
                    className="absolute -inset-y-1 w-px bg-white/30"
                    style={{ left: pct(t.poor) }}
                    aria-hidden
                  />
                </span>
                <VitalValue
                  metric="LCP"
                  value={cell.p75}
                  rating={cell.rating}
                  className="text-right text-sm"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const COLUMNS: VitalMetric[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

function RoutesTable({
  routes,
  selected,
  onSelect,
}: {
  routes: VitalsRoutes;
  selected: string | null;
  onSelect: (route: string) => void;
}) {
  return (
    <Panel
      title="Routes"
      description="Worst first. A dash means fewer than the minimum samples, so no percentile is shown."
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-mute">
            <tr>
              <th className="py-2 pr-3 font-medium">Route</th>
              <th className="py-2 pr-3 text-right font-medium">Views</th>
              {COLUMNS.map((metric) => (
                <th key={metric} className="py-2 pr-3 text-right font-medium">
                  {metric}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {routes.routes.map((route) => (
              <tr
                key={route.route}
                className={cn(
                  "cursor-pointer border-t border-line hover:bg-white/[0.04]",
                  selected === route.route && "bg-white/[0.05]",
                )}
                onClick={() => onSelect(route.route)}
              >
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    onClick={() => onSelect(route.route)}
                    aria-pressed={selected === route.route}
                  >
                    <RatingDot rating={route.rating} />
                    <span
                      className="max-w-[16rem] truncate"
                      title={route.route}
                    >
                      {route.route}
                    </span>
                  </button>
                </td>
                <td className="num py-2 pr-3 text-right text-dim">
                  {route.pageViews.toLocaleString()}
                </td>
                {COLUMNS.map((metric) => {
                  const cell = route.metrics[metric];
                  return (
                    <td
                      key={metric}
                      className="py-2 pr-3 text-right"
                      title={`${cell.samples} samples`}
                    >
                      <VitalValue
                        metric={metric}
                        value={cell.p75}
                        rating={cell.rating}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-mute">
        The device and navigation filters above change every number on this tab.
      </p>
    </Panel>
  );
}
