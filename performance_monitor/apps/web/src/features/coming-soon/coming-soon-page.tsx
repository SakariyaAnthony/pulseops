import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { useScope } from "@/hooks/use-scope";
import { withScope } from "@/lib/scope";

const COPY = {
  traces: {
    title: "Traces",
    body: "Search by trace id, route, or duration, then read a waterfall of HTTP, database, cache, and external spans. The critical path gets a brighter bar. This pass stops at the endpoint’s slowest-trace list.",
  },
  insights: {
    title: "Insights",
    body: "Detectors for N+1 queries, memory slope, slow dependencies, and post-deploy regressions will land here as a feed you can snooze or turn into an alert. The overview already previews the three shop-api signals.",
  },
  missing: {
    title: "That page isn’t in PulseOps",
    body: "The route doesn’t match a screen. Head back to the overview.",
  },
} as const;

export function ComingSoonPage({ page }: { page: keyof typeof COPY }) {
  const scope = useScope();
  const copy = COPY[page];
  useEffect(() => {
    document.title = `${copy.title} · PulseOps`;
  }, [copy.title]);

  return (
    <div className="mx-auto max-w-2xl">
      <Badge className="mb-3 border-violet/40 text-violet">{page === "missing" ? "404" : "Coming soon"}</Badge>
      <PageHeader title={copy.title} description={copy.body} />
      <Link to={withScope("/overview", scope)} className="text-sm text-cyan hover:underline">
        Back to overview
      </Link>
    </div>
  );
}
