import { cn } from "@/lib/utils";

const STYLE: Record<string, string> = {
  healthy: "bg-success/15 text-success",
  degraded: "bg-warning/15 text-warning",
  critical: "bg-danger/15 text-danger",
  firing: "bg-danger/15 text-danger",
  acknowledged: "bg-warning/15 text-warning",
  resolved: "bg-success/15 text-success",
  info: "bg-info/15 text-info",
  warning: "bg-warning/15 text-warning",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", STYLE[status] ?? "bg-white/5 text-dim")}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {status}
    </span>
  );
}
