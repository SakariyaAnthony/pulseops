import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  columnVisibilityFeature,
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { Sparkline } from "@/components/shared/sparkline";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useScope } from "@/hooks/use-scope";
import type { EndpointRow } from "@/lib/api/types";
import { formatApdex, formatCompact, formatMs, formatPct } from "@/lib/format";
import { withScope } from "@/lib/scope";
import { cn } from "@/lib/utils";

const features = tableFeatures({
  rowSortingFeature,
  columnVisibilityFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric },
});

type Features = typeof features;
const helper = createColumnHelper<Features, EndpointRow>();

const LABELS: Record<string, string> = {
  method: "Method",
  route: "Route",
  service: "Service",
  calls: "Calls",
  avgMs: "Avg",
  p95Ms: "p95",
  p99Ms: "p99",
  errorRate: "Error %",
  apdex: "Apdex",
  trend: "Trend",
};

const WIDTH: Record<string, string> = {
  method: "72px",
  route: "minmax(180px,1.6fr)",
  service: "120px",
  calls: "80px",
  avgMs: "84px",
  p95Ms: "84px",
  p99Ms: "84px",
  errorRate: "88px",
  apdex: "72px",
  trend: "120px",
};

const METHOD: Record<string, string> = {
  GET: "text-cyan",
  POST: "text-violet",
  PUT: "text-warning",
  PATCH: "text-info",
  DELETE: "text-danger",
};

const columns = helper.columns([
  helper.accessor("method", {
    header: "Method",
    enableHiding: false,
    sortFn: "alphanumeric",
    cell: (info) => (
      <span
        className={cn(
          "text-xs font-semibold",
          METHOD[info.getValue()] ?? "text-dim",
        )}
      >
        {info.getValue()}
      </span>
    ),
  }),
  helper.accessor("route", {
    header: "Route",
    enableHiding: false,
    sortFn: "alphanumeric",
    cell: (info) => (
      <span className="num truncate text-ink">{info.getValue()}</span>
    ),
  }),
  helper.accessor("service", {
    header: "Service",
    sortFn: "alphanumeric",
    cell: (info) => <span className="text-dim">{info.getValue()}</span>,
  }),
  helper.accessor("calls", {
    header: "Calls",
    sortFn: "basic",
    sortDescFirst: true,
    cell: (info) => (
      <span className="num">{formatCompact(info.getValue())}</span>
    ),
  }),
  helper.accessor("avgMs", {
    header: "Avg",
    sortFn: "basic",
    sortDescFirst: true,
    cell: (info) => <span className="num">{formatMs(info.getValue())}</span>,
  }),
  helper.accessor("p95Ms", {
    header: "p95",
    sortFn: "basic",
    sortDescFirst: true,
    cell: (info) => (
      <span className="num text-ink">{formatMs(info.getValue())}</span>
    ),
  }),
  helper.accessor("p99Ms", {
    header: "p99",
    sortFn: "basic",
    sortDescFirst: true,
    cell: (info) => <span className="num">{formatMs(info.getValue())}</span>,
  }),
  helper.accessor("errorRate", {
    header: "Error %",
    sortFn: "basic",
    sortDescFirst: true,
    cell: (info) => (
      <span
        className={cn("num", info.getValue() >= 1 ? "text-danger" : "text-dim")}
      >
        {formatPct(info.getValue())}
      </span>
    ),
  }),
  helper.accessor("apdex", {
    header: "Apdex",
    sortFn: "basic",
    cell: (info) => <span className="num">{formatApdex(info.getValue())}</span>,
  }),
  helper.display({
    id: "trend",
    header: "Trend",
    enableSorting: false,
    enableHiding: true,
    cell: (info) => (
      <Sparkline data={info.row.original.trend} color="#22D3EE" />
    ),
  }),
]);

/** `readOnly` is for rows measured by a scan: they have no detail page and no trend. */
export function EndpointTable({
  rows,
  readOnly = false,
}: {
  rows: EndpointRow[];
  readOnly?: boolean;
}) {
  const navigate = useNavigate();
  const scope = useScope();
  const parentRef = useRef<HTMLDivElement>(null);
  const table = useTable({
    features,
    data: rows,
    columns,
    initialState: {
      sorting: [{ id: readOnly ? "calls" : "p95Ms", desc: true }],
      columnVisibility: readOnly ? { trend: false } : {},
    },
    getRowId: (row) => row.key,
  });
  const model = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: model.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 8,
  });
  const visible = table.getVisibleLeafColumns();
  const template = visible
    .map((column) => WIDTH[column.id] ?? "100px")
    .join(" ");

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary" size="sm">
              <Columns3 className="h-3.5 w-3.5" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48">
            <p className="mb-2 text-[11px] uppercase tracking-wide text-mute">
              Show
            </p>
            <ul className="space-y-1">
              {table.getAllLeafColumns().map((column) => (
                <li key={column.id}>
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="accent-violet"
                      checked={column.getIsVisible()}
                      disabled={!column.getCanHide()}
                      onChange={() => column.toggleVisibility()}
                    />
                    {LABELS[column.id] ?? column.id}
                  </label>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      </div>
      <div className="overflow-x-auto rounded-xl2 border border-line">
        <div className="min-w-[920px]">
          {table.getHeaderGroups().map((group) => (
            <div
              key={group.id}
              role="row"
              className="grid items-center gap-2 border-b border-line bg-base/40 px-3 py-2"
              style={{ gridTemplateColumns: template }}
            >
              {group.headers.map((header) => {
                const sorted = header.column.getCanSort()
                  ? header.column.getIsSorted()
                  : false;
                return (
                  <button
                    key={header.id}
                    type="button"
                    role="columnheader"
                    className="flex items-center gap-1 text-left text-[11px] font-medium uppercase tracking-wide text-mute"
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                    {sorted === "asc" ? <ArrowUp className="h-3 w-3" /> : null}
                    {sorted === "desc" ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
          <div ref={parentRef} className="relative max-h-[560px] overflow-auto">
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((item) => {
                const row = model[item.index];
                return (
                  <div
                    key={row.id}
                    role="row"
                    tabIndex={0}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    className={cn(
                      "absolute grid w-full items-center gap-2 border-b border-line/70 px-3 hover:bg-white/[0.03] focus-visible:bg-white/[0.04] focus-visible:outline-none",
                      !readOnly && "cursor-pointer",
                    )}
                    style={{
                      height: 52,
                      transform: `translateY(${item.start}px)`,
                      gridTemplateColumns: template,
                    }}
                    onClick={() => {
                      if (!readOnly)
                        navigate(
                          withScope(
                            `/endpoints/${encodeURIComponent(row.original.key)}`,
                            scope,
                          ),
                        );
                    }}
                    onKeyDown={(event) => {
                      if (!readOnly && event.key === "Enter")
                        navigate(
                          withScope(
                            `/endpoints/${encodeURIComponent(row.original.key)}`,
                            scope,
                          ),
                        );
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <div
                        key={cell.id}
                        role="cell"
                        className="min-w-0 truncate text-sm"
                      >
                        <table.FlexRender cell={cell} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
