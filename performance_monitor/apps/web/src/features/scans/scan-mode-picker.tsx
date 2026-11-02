import type { ReactNode } from "react";
import {
  Check,
  FileSearch,
  Globe,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScanSetup } from "@/lib/api/types";

export type ScanMode = "static" | "browser" | "full";

type Need = "repo" | "url";

const MODES: {
  id: ScanMode;
  label: string;
  icon: LucideIcon;
  summary: string;
  needs: Need[];
}[] = [
  {
    id: "static",
    label: "Static",
    icon: FileSearch,
    summary:
      "Reads the repository and finds which asset files your source references.",
    needs: ["repo"],
  },
  {
    id: "browser",
    label: "Runtime",
    icon: Globe,
    summary:
      "Opens your routes in a browser and records requested assets, API calls and page timings.",
    needs: ["url"],
  },
  {
    id: "full",
    label: "Full",
    icon: Layers,
    summary:
      "Runs both and compares them. This gives the most reliable unused-asset result.",
    needs: ["repo", "url"],
  },
];

const NEED_LABEL: Record<Need, string> = {
  repo: "Repository path",
  url: "Base URL",
};

function missingFor(mode: ScanMode, scan: ScanSetup): string[] {
  const entry = MODES.find((item) => item.id === mode);
  if (!entry) return [];
  return entry.needs
    .filter(
      (need) => !(need === "repo" ? scan.repositoryPath : scan.baseUrl).trim(),
    )
    .map((need) => NEED_LABEL[need]);
}

export function ScanModePicker({
  scan,
  value,
  onChange,
  onRun,
  busy,
  aside,
}: {
  scan: ScanSetup;
  value: ScanMode;
  onChange: (mode: ScanMode) => void;
  onRun: () => void;
  busy: boolean;
  aside?: ReactNode;
}) {
  const missing = missingFor(value, scan);
  const selected = MODES.find((mode) => mode.id === value);
  return (
    <div
      className={cn(
        "glass shadow-card rounded-xl2",
        aside && "grid lg:grid-cols-[minmax(0,1fr)_300px]",
      )}
    >
      <div className="min-w-0 p-4">
        <div
          role="radiogroup"
          aria-label="Scan mode"
          className="grid gap-2 sm:grid-cols-3"
        >
          {MODES.map((mode) => {
            const active = mode.id === value;
            const lacking = missingFor(mode.id, scan);
            const Icon = mode.icon;
            return (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(mode.id)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
                  active
                    ? "border-violet bg-violet/10"
                    : "border-line bg-elevated/40 hover:bg-white/5",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-medium text-ink">
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        active ? "text-violet" : "text-mute",
                      )}
                    />
                    {mode.label}
                  </span>
                  {active ? <Check className="h-4 w-4 text-violet" /> : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-dim">
                  {mode.summary}
                </p>
                <p
                  className={cn(
                    "mt-2 text-[11px]",
                    lacking.length ? "text-warning" : "text-success",
                  )}
                >
                  {lacking.length
                    ? `Needs ${lacking.join(" and ").toLowerCase()}`
                    : "Ready"}
                </p>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-mute">
            {missing.length
              ? `Add ${missing.join(" and ").toLowerCase()} in Edit setup to run a ${selected?.label.toLowerCase()} scan.`
              : "An asset missed by one pass stays potentially unused."}
          </p>
          <Button
            size="sm"
            disabled={busy || missing.length > 0}
            onClick={onRun}
          >
            {busy ? "Scanning…" : `Run ${selected?.label.toLowerCase()} scan`}
          </Button>
        </div>
      </div>
      {aside ? (
        <aside className="border-t border-line p-4 lg:border-l lg:border-t-0">
          {aside}
        </aside>
      ) : null}
    </div>
  );
}
