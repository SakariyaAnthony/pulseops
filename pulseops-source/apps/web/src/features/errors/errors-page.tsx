import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { PageHeader } from "@/components/shared/page-header";
import { Sparkline } from "@/components/shared/sparkline";
import { EmptyState, QueryGate } from "@/components/shared/states";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useErrorQuery, useErrorsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import type { ErrorGroup } from "@/lib/api/types";
import { formatCompact, formatRelative, formatStamp } from "@/lib/format";
import { withScope } from "@/lib/scope";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ErrorDetail } from "@/lib/api/types";

export function ErrorsPage() {
  const scope = useScope();
  const query = useErrorsQuery();
  const [search, setSearch] = useState("");
  const detail = useErrorQuery(scope.fingerprint);

  useEffect(() => {
    document.title = "Errors · PulseOps";
  }, []);

  return (
    <QueryGate
      query={query}
      skeleton={<Skeleton className="h-80" />}
      isEmpty={(rows) => rows.length === 0}
      empty={<EmptyState title="No grouped errors" body="Fingerprints show up here after the SDK reports an exception. Dev stays empty until you send one." />}
    >
      {(groups) => (
        <ErrorList groups={groups} search={search} onSearch={setSearch} detail={detail} />
      )}
    </QueryGate>
  );
}

function ErrorList({
  groups,
  search,
  onSearch,
  detail,
}: {
  groups: ErrorGroup[];
  search: string;
  onSearch: (value: string) => void;
  detail: UseQueryResult<ErrorDetail | null>;
}) {
  const scope = useScope();
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter((group) => `${group.type} ${group.message} ${group.service} ${group.route}`.toLowerCase().includes(needle));
  }, [groups, search]);

  return (
    <div>
      <PageHeader eyebrow={`${scope.project} · ${scope.env}`} title="Errors" description="Grouped by fingerprint, with the stack and request context beside the trend." />
      <Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search message, service, or route" aria-label="Search errors" className="max-w-md" />
      {filtered.length === 0 ? (
        <p className="mt-6 text-sm text-dim">No fingerprints match that search.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl2 border border-line">
          {filtered.map((group) => (
            <li key={group.fingerprint}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03]"
                onClick={() => scope.update({ fingerprint: group.fingerprint })}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">
                    <span className="text-danger">{group.type}</span> · {group.message}
                  </p>
                  <p className="mt-1 text-xs text-mute">
                    {group.service} · {group.route} · {formatCompact(group.users)} users · last {formatRelative(group.lastSeen)}
                  </p>
                </div>
                <div className="w-28">
                  <Sparkline data={group.trend} color="#F43F5E" />
                </div>
                <p className="num w-16 text-right text-sm text-ink">{formatCompact(group.count)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Sheet open={!!scope.fingerprint} onOpenChange={(open) => !open && scope.update({ fingerprint: null })}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{detail.data?.type ?? "Error"}</SheetTitle>
            <SheetDescription>{detail.data?.message ?? "Loading the stack…"}</SheetDescription>
          </SheetHeader>
          <SheetBody>
            {detail.isLoading ? <Skeleton className="h-40" /> : null}
            {detail.isError ? (
              <p className="text-sm text-danger">The stack didn’t load. Close and open the fingerprint again.</p>
            ) : null}
            {detail.data ? (
              <div className="space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-xs">
                  {detail.data.context.map((item) => (
                    <div key={item.label}>
                      <dt className="text-mute">{item.label}</dt>
                      <dd className="num mt-0.5 text-ink">{item.value}</dd>
                    </div>
                  ))}
                  <div>
                    <dt className="text-mute">First seen</dt>
                    <dd className="mt-0.5 text-ink">{formatStamp(detail.data.firstSeen)}</dd>
                  </div>
                  <div>
                    <dt className="text-mute">Events</dt>
                    <dd className="num mt-0.5 text-ink">{detail.data.count}</dd>
                  </div>
                </dl>
                <pre className="num overflow-x-auto rounded-xl2 border border-line bg-base p-3 text-xs leading-5 text-dim">{detail.data.stack}</pre>
                <Link to={withScope("/traces", scope)} className="text-xs text-cyan hover:underline">
                  Linked traces ship with the waterfall
                </Link>
              </div>
            ) : null}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}
