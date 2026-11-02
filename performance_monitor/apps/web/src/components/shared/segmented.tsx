import { cn } from "@/lib/utils";

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.03] p-1"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === value}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium text-dim transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
            option.id === value &&
              "bg-violet/20 text-ink shadow-[inset_0_0_0_1px_rgba(124,92,255,0.35)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
