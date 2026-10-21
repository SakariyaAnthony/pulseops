import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Panel } from "@/components/shared/panel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ScanProgress } from "@/features/scans/scan-progress";
import { LabSection } from "@/features/web-vitals/route-detail";
import { formatBytes, formatDuration } from "@/features/web-vitals/format";
import { Segmented, SourceBanner } from "@/features/web-vitals/shared";
import {
  useScansQuery,
  useSettingsQuery,
  useVitalsLabQuery,
} from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import { rateVital, type LabPage } from "@/lib/api/vitals";
import { withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";
import { RatingDot, VitalValue } from "@/features/web-vitals/shared";

type FormFactor = "mobile" | "desktop";

export function LabTab({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (route: string) => void;
}) {
  const scope = useScope();
  const client = useQueryClient();
  const lab = useVitalsLabQuery();
  const scans = useScansQuery();
  const settings = useSettingsQuery();
  const [factor, setFactor] = useState<FormFactor>("mobile");

  const running = scans.data?.find(
    (scan) => scan.status === "queued" || scan.status === "running",
  );
  const newest = scans.data?.[0];
  const failed =
    newest && newest.mode === "vitals" && newest.status === "failed"
      ? newest
      : null;
  const baseUrl = settings.data?.scan.baseUrl ?? "";
  const routes = settings.data?.scan.routes ?? [];

  const start = useMutation({
    mutationFn: () => api.startScan(scope.project, "vitals"),
    onSuccess: async (scan) => {
      await client.invalidateQueries({ queryKey: ["scans", scope.project] });
      await client.invalidateQueries({
        queryKey: ["vitals-lab", scope.project],
      });
      await client.invalidateQueries({ queryKey: ["vitals-detail"] });
      if (scan && scan.status !== "queued" && scan.status !== "running")
        toast.success(`Audit ${scan.status}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.cancelScan(id),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["scans", scope.project] }),
    onError: (error: Error) => toast.error(error.message),
  });

  // New results exist once the running audit clears, so refresh them then.
  const wasRunning = useRef(false);
  const isRunning = Boolean(running);
  useEffect(() => {
    if (wasRunning.current && !isRunning) {
      void client.invalidateQueries({
        queryKey: ["vitals-lab", scope.project],
      });
      void client.invalidateQueries({ queryKey: ["vitals-detail"] });
    }
    wasRunning.current = isRunning;
  }, [isRunning, client, scope.project]);

  const busy = start.isPending || Boolean(running);
  const pages = (lab.data?.pages ?? []).filter(
    (page) => page.formFactor === factor,
  );
  const active =
    pages.find((page) => page.route === selected) ?? pages[0] ?? null;
  const completedAt = lab.data?.scan?.completedAt
    ? new Date(lab.data.scan.completedAt)
    : null;

  return (
    <div className="space-y-4">
      <SourceBanner kind="lab">
        Lab results are synthetic: Lighthouse loads each route in a clean
        browser with fixed throttling. They are reproducible, which makes them
        good for finding a bottleneck, but they are not what real users
        experience. Compare them with the Field tab, never merge them.
      </SourceBanner>

      <Panel
        title="Web Vitals audit"
        description="Runs Lighthouse on every route you configured, once as mobile and once as desktop."
        action={
          baseUrl ? (
            <Button size="sm" onClick={() => start.mutate()} disabled={busy}>
              <Gauge className="h-3.5 w-3.5" />
              {busy ? "Auditing..." : "Run Web Vitals audit"}
            </Button>
          ) : (
            <Button asChild size="sm" variant="secondary">
              <Link to={withScope("/scans", scope)}>
                Set your app address first
              </Link>
            </Button>
          )
        }
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <Fact
            label="App address"
            value={baseUrl || "Not set"}
            warn={!baseUrl}
          />
          <Fact
            label="Routes"
            value={routes.length ? routes.join(", ") : "Not set"}
            warn={routes.length === 0}
          />
          <Fact
            label="Last audit"
            value={completedAt ? completedAt.toLocaleString() : "Never run"}
            warn={!completedAt}
          />
        </dl>
      </Panel>

      {running ? (
        <ScanProgress
          mode={running.mode}
          status={running.status}
          stage={running.progress.stage}
          message={running.progress.message}
          createdAt={running.createdAt}
          cancelling={cancel.isPending}
          onCancel={() => cancel.mutate(running.id)}
        />
      ) : null}

      {failed && !running ? (
        <div
          role="alert"
          className="rounded-xl2 border border-danger/30 bg-danger/10 p-4 text-sm text-ink"
        >
          <p className="font-medium">The last audit failed</p>
          <p className="mt-1 text-xs leading-5 text-dim">
            {failed.errorSummary || "No details were recorded."}
          </p>
        </div>
      ) : null}

      {lab.isLoading ? (
        <Skeleton className="h-64" />
      ) : pages.length === 0 && (lab.data?.pages.length ?? 0) === 0 ? (
        <Panel title="No lab results yet">
          <p className="text-sm leading-6 text-dim">
            Run the audit to see a performance score, LCP, blocking time, layout
            shift and transfer size for each route, plus the likely cause of
            anything slow. Your app must be running at the address above.
          </p>
        </Panel>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              label="Device"
              value={factor}
              onChange={setFactor}
              options={[
                { id: "mobile", label: "Mobile" },
                { id: "desktop", label: "Desktop" },
              ]}
            />
            <p className="text-xs text-mute">
              Throttled{" "}
              {factor === "mobile"
                ? "to a mid-range phone on 4G"
                : "desktop profile"}
              .
            </p>
          </div>
          <Panel
            title="Routes"
            description="Click a route to see what is slowing it."
          >
            <LabTable
              pages={pages}
              selected={active?.route ?? null}
              onSelect={onSelect}
            />
          </Panel>
          {active ? (
            <Panel
              title={`Diagnosis for ${active.route}`}
              description={`Lab test, ${factor}.`}
            >
              <LabSection page={active} />
              <ResourceBreakdown page={active} />
            </Panel>
          ) : null}
        </>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-mute">
        {label}
      </dt>
      <dd
        className={cn("truncate", warn ? "text-warning" : "text-ink")}
        title={value}
      >
        {value}
      </dd>
    </div>
  );
}

function ResourceBreakdown({ page }: { page: LabPage }) {
  const entries = Object.entries(page.resourceSummary).sort(
    (a, b) => b[1].bytes - a[1].bytes,
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-5">
      <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-mute">
        Transferred by type · {formatBytes(page.transferBytes)} in{" "}
        {page.resourceCount ?? "?"} requests
      </p>
      <table className="w-full text-left text-sm">
        <tbody>
          {entries.map(([kind, info]) => (
            <tr key={kind} className="border-t border-line">
              <td className="py-1.5 pr-3 capitalize text-dim">{kind}</td>
              <td className="num py-1.5 pr-3 text-right text-ink">
                {info.count}
              </td>
              <td className="num py-1.5 text-right text-ink">
                {formatBytes(info.bytes)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function scoreClass(score: number | null) {
  if (score === null) return "text-mute";
  if (score >= 90) return "text-success";
  if (score >= 50) return "text-warning";
  return "text-danger";
}

function LabTable({
  pages,
  selected,
  onSelect,
}: {
  pages: LabPage[];
  selected: string | null;
  onSelect: (route: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-mute">
          <tr>
            <th className="py-2 pr-3 font-medium">Route</th>
            <th className="py-2 pr-3 text-right font-medium">Score</th>
            <th className="py-2 pr-3 text-right font-medium">LCP</th>
            <th
              className="py-2 pr-3 text-right font-medium"
              title="Total Blocking Time. Lighthouse's stand-in for INP."
            >
              TBT
            </th>
            <th className="py-2 pr-3 text-right font-medium">CLS</th>
            <th className="py-2 pr-3 text-right font-medium">FCP</th>
            <th className="py-2 pr-3 text-right font-medium">TTFB</th>
            <th className="py-2 pr-3 text-right font-medium">Transfer</th>
            <th className="py-2 text-right font-medium">Requests</th>
          </tr>
        </thead>
        <tbody>
          {pages.map((page) => {
            const failed = page.status === "failed";
            return (
              <tr
                key={`${page.route}-${page.formFactor}`}
                className={cn(
                  "cursor-pointer border-t border-line hover:bg-white/[0.04]",
                  selected === page.route && "bg-white/[0.05]",
                )}
                onClick={() => onSelect(page.route)}
              >
                <td className="py-2 pr-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    onClick={() => onSelect(page.route)}
                    aria-pressed={selected === page.route}
                  >
                    <RatingDot
                      rating={failed ? null : rateVital("LCP", page.lcpMs)}
                    />
                    {page.route}
                  </button>
                </td>
                {failed ? (
                  <td colSpan={8} className="py-2 text-xs text-danger">
                    {page.errorSummary || "Failed"}
                  </td>
                ) : (
                  <>
                    <td
                      className={cn(
                        "num py-2 pr-3 text-right font-medium",
                        scoreClass(page.perfScore),
                      )}
                    >
                      {page.perfScore ?? "—"}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <VitalValue
                        metric="LCP"
                        value={page.lcpMs}
                        rating={rateVital("LCP", page.lcpMs)}
                      />
                    </td>
                    <td className="num py-2 pr-3 text-right text-ink">
                      {formatDuration(page.tbtMs)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <VitalValue
                        metric="CLS"
                        value={page.cls}
                        rating={rateVital("CLS", page.cls)}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <VitalValue
                        metric="FCP"
                        value={page.fcpMs}
                        rating={rateVital("FCP", page.fcpMs)}
                      />
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <VitalValue
                        metric="TTFB"
                        value={page.ttfbMs}
                        rating={rateVital("TTFB", page.ttfbMs)}
                      />
                    </td>
                    <td className="num py-2 pr-3 text-right text-ink">
                      {formatBytes(page.transferBytes)}
                    </td>
                    <td className="num py-2 text-right text-ink">
                      {page.resourceCount ?? "—"}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-mute">
        Lighthouse does not measure INP. TBT (Total Blocking Time) is shown
        instead.
      </p>
    </div>
  );
}
