import { useState } from "react";
import { BellRing, Info, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Incident, Severity } from "@/lib/api/types";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

const TONE: Record<Severity, { bar: string; text: string; ring: string; label: string; Icon: typeof Info }> = {
  critical: { bar: "bg-danger", text: "text-danger", ring: "border-danger/40", label: "Critical", Icon: BellRing },
  warning: { bar: "bg-warning", text: "text-warning", ring: "border-warning/40", label: "Warning", Icon: TriangleAlert },
  info: { bar: "bg-info", text: "text-info", ring: "border-info/40", label: "Info", Icon: Info },
};

type BannerProps = {
  incident: Incident;
  onView: () => void;
  onAck: () => Promise<void>;
  onDismiss: () => void;
};

function AlertBanner({ incident, onView, onAck, onDismiss }: BannerProps) {
  const tone = TONE[incident.severity];
  const [acking, setAcking] = useState(false);
  return (
    <div
      role="alert"
      className={cn(
        "relative w-[360px] overflow-hidden rounded-xl2 border bg-elevated text-ink shadow-card",
        tone.ring,
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", tone.bar)} aria-hidden />
      <img
        src={`/push/${incident.severity}.png`}
        alt=""
        className="h-20 w-full object-cover object-bottom opacity-90"
        draggable={false}
      />
      <div className="px-4 pb-3 pt-3">
        <div className="flex items-start gap-2.5">
          <tone.Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone.text)} aria-hidden />
          <div className="min-w-0 flex-1">
            <p className={cn("text-[11px] font-semibold uppercase tracking-wider", tone.text)}>
              {tone.label} · {incident.env}
            </p>
            <p className="mt-0.5 truncate text-sm font-medium">{incident.title}</p>
            {incident.detail ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-dim">{incident.detail}</p> : null}
            <p className="mt-1 text-[11px] text-mute">
              {incident.service} · {formatRelative(incident.startedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-md p-1 text-mute transition hover:bg-white/5 hover:text-ink"
            aria-label="Dismiss alert"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={acking}
            onClick={async () => {
              setAcking(true);
              try {
                await onAck();
              } finally {
                setAcking(false);
              }
            }}
          >
            {acking ? "Acknowledging…" : "Acknowledge"}
          </Button>
          <Button size="sm" onClick={onView}>
            View incident
          </Button>
        </div>
      </div>
    </div>
  );
}

const shown = new Set<string>();

/** Shows one banner per incident. Critical banners stay until dismissed. */
export function showAlertBanner(
  incident: Incident,
  handlers: { onView: (incident: Incident) => void; onAck: (incident: Incident) => Promise<void> },
) {
  if (incident.status !== "firing" || shown.has(incident.id)) return;
  shown.add(incident.id);
  const id = `incident-${incident.id}`;
  toast.custom(
    () => (
      <AlertBanner
        incident={incident}
        onDismiss={() => toast.dismiss(id)}
        onView={() => {
          toast.dismiss(id);
          handlers.onView(incident);
        }}
        onAck={async () => {
          try {
            await handlers.onAck(incident);
            toast.dismiss(id);
            toast.success("Incident acknowledged");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Couldn’t acknowledge the incident");
          }
        }}
      />
    ),
    {
      id,
      duration: incident.severity === "critical" ? Number.POSITIVE_INFINITY : 8000,
      unstyled: true,
    },
  );
}

export function dismissAlertBanner(incidentId: string) {
  toast.dismiss(`incident-${incidentId}`);
}
