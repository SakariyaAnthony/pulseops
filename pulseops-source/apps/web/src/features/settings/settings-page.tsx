import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import { maskKey } from "@/lib/api/overrides";
import type { ScanSetup } from "@/lib/api/types";
import { withScope } from "@/lib/scope";
import { useUi, type Density } from "@/store/ui";

export function SettingsPage() {
  const scope = useScope();
  const query = useSettingsQuery();
  const density = useUi((state) => state.density);
  const setDensity = useUi((state) => state.setDensity);
  const client = useQueryClient();
  const [revealed, setRevealed] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Settings · PulseOps";
  }, []);

  const rotate = useMutation({
    mutationFn: () => Promise.resolve(api.rotate(scope.project)),
    onSuccess: (key) => {
      setRevealed(key);
      void client.invalidateQueries({ queryKey: ["settings"] });
      toast.success("API key rotated");
    },
  });

  return (
    <QueryGate query={query} skeleton={<Skeleton className="h-96" />}>
      {(settings) => (
        <div className="mx-auto max-w-3xl">
          <PageHeader eyebrow={settings.project.name} title="Settings" description="Project, keys, who can see the workspace, and how long telemetry is kept." />
          <div className="space-y-4">
            <Panel title="Project">
              <p className="text-sm text-ink">{settings.project.name}</p>
              <p className="num mt-1 text-xs text-mute">{settings.project.id}</p>
            </Panel>
            <Panel title="Environments">
              <ul className="divide-y divide-line">
                {settings.environments.map((env) => (
                  <li key={env.name} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-ink">{env.name}</span>
                    <span className="text-mute">{env.region}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel
              title="API key"
              description="Shown in full once after rotation. Ingest calls send it as X-API-Key."
              action={
                <Button size="sm" variant="secondary" onClick={() => rotate.mutate()} disabled={rotate.isPending}>
                  Rotate
                </Button>
              }
            >
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-base/50 px-3 py-2">
                <code className="num truncate text-sm text-ink">{maskKey(settings.apiKey)}</code>
                <CopyButton value={settings.apiKey} />
              </div>
            </Panel>
            <Panel title="Team">
              {settings.team.length === 0 ? <p className="text-sm text-dim">Not configured</p> : null}
              <ul className="divide-y divide-line">
                {settings.team.map((member) => (
                  <li key={member.email} className="flex items-center justify-between gap-3 py-2">
                    <div>
                      <p className="text-sm text-ink">{member.name}</p>
                      <p className="text-xs text-mute">{member.email}</p>
                    </div>
                    <span className="text-xs text-dim">{member.role}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Notification channels">
              {settings.channels.length === 0 ? <p className="text-sm text-dim">Not configured</p> : null}
              <ul className="space-y-2">
                {settings.channels.map((channel) => (
                  <li key={channel.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                    <span className="text-ink">
                      {channel.kind} · <span className="text-dim">{channel.target}</span>
                    </span>
                    <span className={channel.enabled ? "text-success" : "text-mute"}>{channel.enabled ? "On" : "Off"}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Retention">
              {settings.retention.length === 0 ? <p className="text-sm text-dim">Not configured</p> : null}
              <ul className="divide-y divide-line">
                {settings.retention.map((item) => (
                  <li key={item.label} className="flex items-center justify-between py-2 text-sm">
                    <span className="text-dim">{item.label}</span>
                    <span className="text-ink">{item.value}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <ScanConfigForm project={scope.project} scan={settings.scan} />
            <Panel title="Density" description="Compact tightens the page padding and KPI type.">
              <div className="flex gap-2">
                {(["comfortable", "compact"] as Density[]).map((option) => (
                  <Button key={option} size="sm" variant={density === option ? "secondary" : "ghost"} onClick={() => setDensity(option)}>
                    {option}
                  </Button>
                ))}
              </div>
            </Panel>
          </div>
          <Dialog open={!!revealed} onOpenChange={(open) => !open && setRevealed(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Copy the new key</DialogTitle>
                <DialogDescription>This is the only time the full key is shown. Store it with the SDK.</DialogDescription>
              </DialogHeader>
              <code className="num block overflow-x-auto rounded-lg border border-line bg-base p-3 text-sm text-ink">{revealed}</code>
              <div className="mt-3 flex justify-end">
                <CopyButton value={revealed ?? ""} />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </QueryGate>
  );
}

function ScanConfigForm({ project, scan }: { project: string; scan: ScanSetup }) {
  const scope = useScope();
  const client = useQueryClient();
  const [draft, setDraft] = useState(scan);
  useEffect(() => {
    setDraft(scan);
  }, [scan]);
  const save = useMutation({
    mutationFn: () =>
      api.saveScanConfig(project, {
        ...draft,
        routes: draft.routes.map((route) => route.trim()).filter(Boolean),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["settings", project] });
      toast.success("Scan settings saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const field = (label: string, value: string, onChange: (value: string) => void, placeholder?: string) => (
    <label className="block text-sm">
      <span className="text-dim">{label}</span>
      <Input className="mt-1" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
  return (
    <Panel
      title="Lab scan"
      description="PulseOps stores the start command and does not run it. The repository must sit inside PULSEOPS_SCAN_ROOTS."
      action={
        <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      }
    >
      <div className="space-y-3">
        {field("Repository path", draft.repositoryPath, (repositoryPath) => setDraft({ ...draft, repositoryPath }), "/absolute/path/to/app")}
        {field("Base URL", draft.baseUrl, (baseUrl) => setDraft({ ...draft, baseUrl }), "http://127.0.0.1:5173")}
        <label className="block text-sm">
          <span className="text-dim">Routes</span>
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border border-line bg-base/70 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-violet"
            value={draft.routes.join("\n")}
            onChange={(event) => setDraft({ ...draft, routes: event.target.value.split("\n") })}
          />
        </label>
        <div className="grid grid-cols-3 gap-2">
          {field("Width", String(draft.viewportWidth), (value) => setDraft({ ...draft, viewportWidth: Number(value) || 1280 }))}
          {field("Height", String(draft.viewportHeight), (value) => setDraft({ ...draft, viewportHeight: Number(value) || 720 }))}
          {field("Timeout ms", String(draft.timeoutMs), (value) => setDraft({ ...draft, timeoutMs: Number(value) || 15000 }))}
        </div>
        {field("Start command", draft.startCommand, (startCommand) => setDraft({ ...draft, startCommand }), "npm run dev")}
        {draft.framework ? <p className="text-xs text-mute">Detected framework: {draft.framework}</p> : null}
        <Link className="text-xs text-violet" to={withScope("/scans", scope)}>
          Open scans
        </Link>
      </div>
    </Panel>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          toast.success("Copied");
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      Copy
    </Button>
  );
}
