import { ApdexGauge } from "@/components/shared/apdex-gauge";
import { DeltaChip } from "@/components/shared/delta-chip";
import { Sparkline } from "@/components/shared/sparkline";
import type { Kpi } from "@/lib/api/types";
import { formatKpi } from "@/lib/format";
import { cn } from "@/lib/utils";

const COLOR: Record<string, string> = {
  avg: "#22D3EE",
  p95: "#7C5CFF",
  rpm: "#60A5FA",
  error: "#F43F5E",
  apdex: "#34D399",
};

function breach(kpi: Kpi): "danger" | "warning" | null {
  if (kpi.id === "p95" && kpi.value >= 800) return "danger";
  if (kpi.id === "p95" && kpi.value >= 500) return "warning";
  if (kpi.id === "error" && kpi.value >= 1) return "danger";
  if (kpi.id === "error" && kpi.value >= 0.5) return "warning";
  if (kpi.id === "apdex" && kpi.value < 0.9) return "danger";
  if (kpi.id === "apdex" && kpi.value < 0.94) return "warning";
  if (kpi.id === "avg" && kpi.value >= 400) return "warning";
  return null;
}

export function KpiCard({ kpi }: { kpi: Kpi }) {
  const level = breach(kpi);
  return (
    <article
      className={cn(
        "glass glass-hover shadow-card relative overflow-hidden rounded-xl2 p-4",
        level === "danger" && "shadow-[0_0_24px_-4px_rgba(244,63,94,0.45)]",
        level === "warning" && "shadow-[0_0_24px_-4px_rgba(251,191,36,0.4)]",
      )}
    >
      <span
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-20 blur-2xl"
        style={{ background: COLOR[kpi.id] ?? "#7C5CFF" }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: COLOR[kpi.id] ?? "#7C5CFF" }}
            aria-hidden
          />
          {kpi.label}
        </p>
        <DeltaChip delta={kpi.delta} intent={kpi.intent} />
      </div>
      <p className="kpi-value num relative mt-3 text-[32px] font-semibold leading-none tracking-tight text-ink">
        {formatKpi(kpi.value, kpi.unit)}
      </p>
      <div className="relative mt-3">
        {kpi.unit === "apdex" ? (
          <ApdexGauge value={kpi.value} />
        ) : (
          <Sparkline data={kpi.spark} color={COLOR[kpi.id] ?? "#7C5CFF"} />
        )}
      </div>
    </article>
  );
}
