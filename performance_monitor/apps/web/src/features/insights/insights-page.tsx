import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState, PageSkeleton, QueryGate } from "@/components/shared/states";
import { useInsightsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { RANGE_LABEL, withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

export function InsightsPage() {
  const scope = useScope();
  const query = useInsightsQuery();

  useEffect(() => {
    document.title = "Insights · PulseOps";
  }, []);

  return (
    <QueryGate
      query={query}
      skeleton={<PageSkeleton />}
      isEmpty={(rows) => rows.length === 0}
      empty={
        <EmptyState
          title="No findings in this range"
          body="Slow pages, slow fetches, and repeated JavaScript errors show up here after the browser snippet reports them."
        />
      }
    >
      {(insights) => (
        <div>
          <PageHeader
            eyebrow={`${scope.project} · ${scope.env}`}
            title="Insights"
            description={`${RANGE_LABEL[scope.range]}. Findings are computed from the rollups for this project.`}
          />
          <ul className="space-y-3">
            {insights.map((insight) => (
              <li key={insight.id} className="rounded-xl2 border border-line bg-surface/80 p-4">
                <p
                  className={cn(
                    "text-[11px] font-medium uppercase tracking-wide",
                    insight.severity === "critical" ? "text-danger" : insight.severity === "warning" ? "text-warning" : "text-info",
                  )}
                >
                  {insight.severity}
                </p>
                <p className="mt-1 text-sm text-ink">{insight.title}</p>
                <p className="mt-1 text-xs leading-5 text-dim">{insight.body}</p>
                <Link to={withScope(insight.href, scope)} className="mt-3 inline-block text-xs text-cyan hover:underline">
                  Open evidence
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </QueryGate>
  );
}
