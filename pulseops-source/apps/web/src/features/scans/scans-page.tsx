import { useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useScansQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import { withScope } from "@/lib/scope";

const MODES = [
  { id: "static", label: "Static assets" },
  { id: "browser", label: "Browser" },
  { id: "full", label: "Full" },
] as const;

export function ScansPage() {
  const scope = useScope();
  const query = useScansQuery();
  const client = useQueryClient();

  useEffect(() => {
    document.title = "Scans · PulseOps";
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
      {(scans) => (
        <div>
          <PageHeader
            eyebrow={scope.project}
            title="Scans"
            description="Lab scans read the repository and open the routes you configured. They stay separate from live SDK traffic."
          />
          <div className="mb-4 flex flex-wrap gap-2">
            {MODES.map((mode) => (
              <Button key={mode.id} size="sm" variant="secondary" disabled={start.isPending} onClick={() => start.mutate(mode.id)}>
                {mode.label}
              </Button>
            ))}
          </div>
          <Panel title="Recent scans" description="Configure the repository path and base URL in Settings.">
            {scans.length === 0 ? <p className="text-sm text-dim">No scans for this project yet.</p> : null}
            <ul className="divide-y divide-line">
              {scans.map((scan) => (
                <li key={scan.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <Link className="text-ink hover:text-violet" to={withScope(`/scans/${scan.id}`, scope)}>
                      {scan.mode} · {scan.status}
                    </Link>
                    <p className="text-xs text-mute">{scan.errorSummary || scan.progress.message || scan.createdAt}</p>
                  </div>
                  <span className="num text-xs text-dim">{scan.id.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </QueryGate>
  );
}
