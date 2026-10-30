import { useEffect, useState } from "react";
import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api/client";
import type { Severity } from "@/lib/api/types";
import {
  ALL_SEVERITIES,
  currentSubscription,
  disablePush,
  enablePush,
  getPermissionState,
  setPushSeverities,
  storedSeverities,
  type PushPermission,
} from "@/lib/push";
import { cn } from "@/lib/utils";

const SEVERITY_HINT: Record<Severity, string> = {
  critical: "Stays on screen until you act on it",
  warning: "Thresholds crossed that need a look",
  info: "Heads-up rules",
};

type State = {
  permission: PushPermission;
  serverReady: boolean | null;
  subscribed: boolean;
};

export function PushPanel() {
  const [state, setState] = useState<State>({ permission: getPermissionState(), serverReady: null, subscribed: false });
  const [severities, setSeverities] = useState<Severity[]>(storedSeverities);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.pushConfig(), currentSubscription()]).then(([config, subscription]) => {
      if (cancelled) return;
      setState({ permission: getPermissionState(), serverReady: config.enabled, subscribed: !!subscription });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = state.subscribed && state.permission === "granted";

  const turnOn = async () => {
    setBusy(true);
    try {
      const info = await enablePush(severities);
      setSeverities(info.severities);
      setState((current) => ({ ...current, permission: "granted", subscribed: true }));
      toast.success("Push notifications are on for this browser");
    } catch (error) {
      setState((current) => ({ ...current, permission: getPermissionState() }));
      toast.error(error instanceof Error ? error.message : "Couldn’t turn on notifications");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      setState((current) => ({ ...current, subscribed: false }));
      toast.success("Push notifications are off for this browser");
    } finally {
      setBusy(false);
    }
  };

  const toggleSeverity = async (severity: Severity, on: boolean) => {
    const next = ALL_SEVERITIES.filter((item) => (item === severity ? on : severities.includes(item)));
    setSeverities(next);
    if (!enabled) return;
    try {
      await setPushSeverities(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t save the preference");
    }
  };

  return (
    <Panel
      title="Push notifications"
      description="Alert incidents show as a banner while PulseOps is open, and as a system notification with actions when the tab is in the background or closed."
      action={
        state.permission === "unsupported" ? null : enabled ? (
          <Button size="sm" variant="secondary" onClick={turnOff} disabled={busy}>
            <BellOff className="h-3.5 w-3.5" />
            Turn off
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={turnOn}
            disabled={busy || state.permission === "denied" || state.serverReady === false}
          >
            <BellRing className="h-3.5 w-3.5" />
            {busy ? "Turning on…" : "Turn on"}
          </Button>
        )
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>This browser:</span>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
            enabled
              ? "bg-success/15 text-success"
              : state.permission === "denied"
                ? "bg-danger/15 text-danger"
                : "bg-white/5 text-dim",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {state.permission === "unsupported"
            ? "Web Push not supported"
            : enabled
              ? "Subscribed"
              : state.permission === "denied"
                ? "Notifications blocked"
                : "Not subscribed"}
        </span>
      </div>
      {state.permission === "denied" ? (
        <p className="mb-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs leading-5 text-ink">
          Notifications are blocked for this site. Click the site settings icon next to the address bar, allow
          Notifications, then reload the page.
        </p>
      ) : null}
      {state.serverReady === false ? (
        <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-ink">
          The API has no VAPID keys yet. Run <code className="num">python tools/gen_vapid.py</code> in apps/api,
          paste the output into apps/api/.env and restart the API. In-app banners work without it.
        </p>
      ) : null}
      <ul className="divide-y divide-line">
        {ALL_SEVERITIES.map((severity) => (
          <li key={severity} className="flex items-center justify-between gap-3 py-2">
            <div className="flex items-center gap-3">
              <StatusBadge status={severity} />
              <span className="text-xs text-mute">{SEVERITY_HINT[severity]}</span>
            </div>
            <Switch
              checked={severities.includes(severity)}
              aria-label={`Push ${severity} alerts`}
              onCheckedChange={(on) => void toggleSeverity(severity, on)}
            />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-5 text-mute">
        Chrome and Edge show the action buttons everywhere, and the chart image on Windows, Linux and Android (macOS
        drops it). Firefox and Safari show the title, text and icon. On iPhone, add PulseOps to the home screen first.
      </p>
    </Panel>
  );
}
