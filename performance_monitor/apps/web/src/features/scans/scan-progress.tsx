import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = { id: string; label: string };

const START: Step = { id: "start", label: "Starting" };
const STATIC: Step = { id: "static", label: "Reading repository" };
const BROWSER: Step = { id: "browser", label: "Opening routes" };
const AUDIT: Step = { id: "lighthouse", label: "Auditing routes" };
const CLASSIFY: Step = { id: "classify", label: "Classifying results" };

function stepsFor(mode: string): Step[] {
  if (mode === "vitals") return [START, AUDIT];
  if (mode === "static") return [START, STATIC, CLASSIFY];
  if (mode === "browser") return [START, BROWSER, CLASSIFY];
  return [START, STATIC, BROWSER, CLASSIFY];
}

function elapsed(since: string, now: number) {
  const started = Date.parse(since);
  if (Number.isNaN(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function ScanProgress({
  mode,
  status,
  stage,
  message,
  createdAt,
  onCancel,
  cancelling,
}: {
  mode: string;
  status: string;
  stage?: string;
  message?: string;
  createdAt?: string;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const steps = stepsFor(mode);
  const queued = status === "queued" || !stage;
  const current = queued
    ? -1
    : Math.max(
        0,
        steps.findIndex((step) => step.id === stage),
      );
  const within =
    stage === "static" ? (message?.startsWith("Parsing") ? 0.75 : 0.25) : 0.5;
  const percent = queued
    ? 3
    : Math.min(97, Math.round(((current + within) / steps.length) * 100));
  const time = createdAt ? elapsed(createdAt, now) : null;
  const heading = queued
    ? "Waiting to start"
    : message || steps[current]?.label || "Scanning";

  return (
    <section
      className="glass shadow-card rounded-xl2 p-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Loader2
            className="h-5 w-5 animate-spin text-violet motion-reduce:animate-none"
            aria-hidden
          />
          <div>
            <p className="text-sm font-medium text-ink">{heading}…</p>
            <p className="text-xs text-mute">
              {mode === "browser"
                ? "Runtime scan"
                : mode === "vitals"
                  ? "Web Vitals audit"
                  : `${mode.charAt(0).toUpperCase() + mode.slice(1)} scan`}
              {time ? ` · ${time} elapsed` : ""}
            </p>
          </div>
        </div>
        {onCancel ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null}
      </div>

      <div
        className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/5"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Scan progress"
      >
        <div
          className="h-full rounded-full bg-violet transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
        <div className="absolute inset-y-0 left-0 w-1/4 animate-indeterminate rounded-full bg-white/25 motion-reduce:hidden" />
      </div>

      <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {steps.map((step, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li
              key={step.id}
              className={cn(
                "flex items-center gap-2 text-xs",
                done ? "text-success" : active ? "text-ink" : "text-mute",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : active ? (
                <Loader2
                  className="h-3.5 w-3.5 animate-spin text-violet motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-mute/60"
                  aria-hidden
                />
              )}
              {step.label}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-mute">
        Results from earlier scans are hidden until this one finishes.
      </p>
    </section>
  );
}
