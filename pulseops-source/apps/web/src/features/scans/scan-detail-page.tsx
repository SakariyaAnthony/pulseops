import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScanApisQuery, useScanAssetsQuery, useScanPagesQuery, useScanQuery } from "@/hooks/queries";
import type { ScanEndpoint, ScanPage } from "@/lib/api/types";
import { api } from "@/lib/api/client";
import { AssetReport } from "@/features/scans/asset-report";

function bytes(value: number | null) {
  if (value == null) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function ms(value: number | null) {
  return value == null ? "—" : `${Math.round(value)} ms`;
}

export function ScanDetailPage() {
  const { id = "" } = useParams();
  const query = useScanQuery(id);
  const client = useQueryClient();
  const finished = query.data != null && query.data.status !== "queued" && query.data.status !== "running";
  const assets = useScanAssetsQuery(id, finished);
  const apis = useScanApisQuery(id, finished);
  const pages = useScanPagesQuery(id, finished);

  useEffect(() => {
    document.title = "Scan · PulseOps";
  }, []);

  const cancel = useMutation({
    mutationFn: () => api.cancelScan(id),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["scan", id] });
      toast.success("Scan cancelled");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <QueryGate query={query} skeleton={<Skeleton className="h-80" />}>
      {(scan) =>
        scan ? (
          <div className="space-y-4">
            <PageHeader
              eyebrow={scan.mode}
              title={scan.status}
              description={scan.errorSummary || scan.progress.message || "Lab measurements from this scan. Live SDK traffic is unchanged."}
            />
            {scan.status === "queued" || scan.status === "running" ? (
              <Button size="sm" variant="secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel
              </Button>
            ) : null}
            <AssetReport summary={assets.data?.summary ?? null} ready={finished && !assets.isLoading} />
            <Panel title="API" description="Percentiles come from this scan's samples. p95 needs at least 5 samples and p99 needs at least 20.">
              <ApiTable rows={apis.data?.endpoints ?? []} empty={finished && (apis.data?.endpoints.length ?? 0) === 0} />
            </Panel>
            <Panel title="Pages" description="These are lab measurements from the browser scan, not field data from the SDK.">
              <PageTable rows={pages.data ?? []} empty={finished && (pages.data?.length ?? 0) === 0} />
            </Panel>
          </div>
        ) : (
          <p className="text-sm text-dim">Scan not found.</p>
        )
      }
    </QueryGate>
  );
}

function ApiTable({ rows, empty }: { rows: ScanEndpoint[]; empty: boolean }) {
  if (empty) return <p className="text-sm text-dim">No API calls captured.</p>;
  if (rows.length === 0) return <p className="text-sm text-dim">Results appear when the scan finishes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-mute">
          <tr>
            <th className="py-2 pr-3 font-medium">Endpoint</th>
            <th className="py-2 pr-3 font-medium">Count</th>
            <th className="py-2 pr-3 font-medium">Median</th>
            <th className="py-2 pr-3 font-medium">p95</th>
            <th className="py-2 pr-3 font-medium">p99</th>
            <th className="py-2 pr-3 font-medium">Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.method} ${row.endpointTemplate}`} className="border-t border-line">
              <td className="py-2 pr-3 text-ink">
                {row.method} {row.endpointTemplate}
              </td>
              <td className="num py-2 pr-3 text-dim">{row.count}</td>
              <td className="num py-2 pr-3 text-dim">{ms(row.medianMs)}</td>
              <td className="num py-2 pr-3 text-dim">{ms(row.p95Ms)}</td>
              <td className="num py-2 pr-3 text-dim">{ms(row.p99Ms)}</td>
              <td className="num py-2 pr-3 text-dim">{row.errorRate == null ? "—" : `${Math.round(row.errorRate * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageTable({ rows, empty }: { rows: ScanPage[]; empty: boolean }) {
  if (empty) return <p className="text-sm text-dim">No pages recorded.</p>;
  if (rows.length === 0) return <p className="text-sm text-dim">Results appear when the scan finishes.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((page) => (
        <li key={page.route} className="py-2 text-sm">
          <p className="text-ink">
            {page.route} · {page.status} · {page.metricSource}
          </p>
          <p className="text-xs text-mute">
            LCP {ms(page.lcpMs)} · CLS {page.cls == null ? "—" : page.cls.toFixed(3)} · transfer {bytes(page.totalTransferBytes)} · samples {page.sampleCount}
          </p>
          {page.errorSummary ? <p className="mt-1 text-xs text-dim">{page.errorSummary}</p> : null}
        </li>
      ))}
    </ul>
  );
}
