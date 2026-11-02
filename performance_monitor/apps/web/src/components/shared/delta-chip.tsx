import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatDelta } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DeltaChip({ delta, intent }: { delta: number; intent: "lower" | "higher" }) {
  const flat = Math.abs(delta) < 0.05;
  const improved = !flat && (intent === "lower" ? delta < 0 : delta > 0);
  const worse = !flat && !improved;
  const Icon = delta >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium",
        improved && "bg-success/15 text-success",
        worse && "bg-danger/15 text-danger",
        flat && "bg-white/5 text-dim",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {formatDelta(delta)}
    </span>
  );
}
