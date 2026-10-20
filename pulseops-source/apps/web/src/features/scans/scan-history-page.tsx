import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useScansQuery, useSettingsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { withScope } from "@/lib/scope";
import { ScanHistoryList } from "@/features/scans/recent-scans";

export function ScanHistoryPage() {
  const scope = useScope();
  const query = useScansQuery();
  const settings = useSettingsQuery();

  useEffect(() => {
    document.title = "Scan history · PulseOps";
  }, []);

  return (
    <div className="space-y-4">
      <Link
        to={withScope("/scans", scope)}
        className="inline-flex items-center gap-1.5 text-xs text-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        Asset Intelligence Scanner
      </Link>
      <PageHeader eyebrow={scope.project} title="Scan history" description="Every scan for this project. Select a scan to see its details." />
      <QueryGate query={query} skeleton={<Skeleton className="h-80" />}>
        {(scans) => (
          <Panel>
            <ScanHistoryList
              scans={scans}
              projectName={settings.data?.project.name || scope.project}
              scopeLink={(path) => withScope(path, scope)}
            />
          </Panel>
        )}
      </QueryGate>
    </div>
  );
}
