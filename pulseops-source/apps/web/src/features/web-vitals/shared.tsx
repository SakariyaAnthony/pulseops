import type { ReactNode } from "react";
import { Info } from "lucide-react";
import {
  formatVital,
  type VitalMetric,
  type VitalRating,
} from "@/lib/api/vitals";
import {
  RATING_BG,
  RATING_LABEL,
  RATING_TEXT,
} from "@/features/web-vitals/format";
import { cn } from "@/lib/utils";

/** A value coloured by its rating. Shows a dash when there is not enough data. */
export function VitalValue({
  metric,
  value,
  rating,
  className,
}: {
  metric: VitalMetric;
  value: number | null;
  rating: VitalRating | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "num tabular-nums",
        rating ? RATING_TEXT[rating] : "text-mute",
        className,
      )}
      title={rating ? RATING_LABEL[rating] : "Not enough data"}
    >
      {formatVital(metric, value)}
    </span>
  );
}

export function RatingDot({ rating }: { rating: VitalRating | null }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        rating ? RATING_BG[rating] : "bg-mute/50",
      )}
      aria-hidden
    />
  );
}

/** Keeps field and lab results visibly apart. */
export function SourceBanner({
  kind,
  children,
}: {
  kind: "field" | "lab";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl2 border px-4 py-3 text-xs leading-5 text-dim",
        kind === "field"
          ? "border-cyan/25 bg-cyan/5"
          : "border-violet/25 bg-violet/5",
      )}
    >
      <Info
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          kind === "field" ? "text-cyan" : "text-violet",
        )}
        aria-hidden
      />
      <p>{children}</p>
    </div>
  );
}

export function SourceTag({ kind }: { kind: "field" | "lab" }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
        kind === "field"
          ? "border-cyan/30 bg-cyan/10 text-cyan"
          : "border-violet/30 bg-violet/10 text-violet",
      )}
    >
      {kind === "field" ? "Real users" : "Lab test"}
    </span>
  );
}
