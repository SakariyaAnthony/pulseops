import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ConnectDialog,
  ConnectSnippet,
} from "@/features/settings/connect-snippet";
import { useProjectsQuery, useSettingsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import { maskKey } from "@/lib/api/overrides";
import { useUi, type Density } from "@/store/ui";

export function SettingsPage() {
  const scope = useScope();
  const query = useSettingsQuery();
  const density = useUi((state) => state.density);
  const setDensity = useUi((state) => state.setDensity);
  const client = useQueryClient();
  const [revealed, setRevealed] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const projects = useProjectsQuery();
  const others = (projects.data ?? []).filter(
    (item) => item.slug !== scope.project,
  );

  useEffect(() => {
    document.title = "Settings · PulseOps";
  }, []);

  const rotate = useMutation({
    mutationFn: () => api.rotate(scope.project),
    onSuccess: (key) => {
      setRevealed(key);
      void client.invalidateQueries({ queryKey: ["settings"] });
      toast.success("New API key created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (slug: string) => api.deleteProject(slug),
    onSuccess: async (_result, slug) => {
      const next = others[0];
      setDeleting(false);
      setConfirmName("");
      // Move to another project first so no page keeps asking for the deleted one.
      if (next) scope.update({ project: next.slug });
      await client.cancelQueries();
      client.removeQueries({
        predicate: (entry) => entry.queryKey.includes(slug),
      });
      await client.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <QueryGate query={query} skeleton={<Skeleton className="h-96" />}>
      {(settings) => (
        <div className="mx-auto max-w-3xl">
          <PageHeader
            eyebrow={settings.project.name}
            title="Settings"
            description="Project, keys, who can see the workspace, and how long telemetry is kept."
          />
          <div className="space-y-4">
            <Panel title="Project">
              <p className="text-sm text-ink">{settings.project.name}</p>
              <p className="num mt-1 text-xs text-mute">
                {settings.project.id}
              </p>
            </Panel>
            <Panel title="Environments">
              <ul className="divide-y divide-line">
                {settings.environments.map((env) => (
                  <li
                    key={env.name}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-ink">{env.name}</span>
                    <span className="text-mute">{env.region}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel
              title="API key"
              description="Only the start of the key is kept for display. Generating a new key shows the full key once, and the current key stops working."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Generate a new key? The current key stops working, so update the snippet in your app.",
                      )
                    )
                      rotate.mutate();
                  }}
                  disabled={rotate.isPending}
                >
                  Generate new key
                </Button>
              }
            >
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-base/50 px-3 py-2">
                <code className="num truncate text-sm text-ink">
                  {maskKey(settings.apiKey)}
                </code>
                {settings.apiKey.length > 14 ? (
                  <CopyButton value={settings.apiKey} />
                ) : null}
              </div>
            </Panel>
            <Panel
              title="Connect live traffic"
              description="Optional. Capture API calls on the API page needs none of this. Add the snippet to see real traffic from your app as you use it."
            >
              <ConnectSnippet
                serviceName={settings.project.name}
                apiKey={null}
              />
            </Panel>
            <Panel title="Team">
              {settings.team.length === 0 ? (
                <p className="text-sm text-dim">Not configured</p>
              ) : null}
              <ul className="divide-y divide-line">
                {settings.team.map((member) => (
                  <li
                    key={member.email}
                    className="flex items-center justify-between gap-3 py-2"
                  >
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
              {settings.channels.length === 0 ? (
                <p className="text-sm text-dim">Not configured</p>
              ) : null}
              <ul className="space-y-2">
                {settings.channels.map((channel) => (
                  <li
                    key={channel.id}
                    className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <span className="text-ink">
                      {channel.kind} ·{" "}
                      <span className="text-dim">{channel.target}</span>
                    </span>
                    <span
                      className={channel.enabled ? "text-success" : "text-mute"}
                    >
                      {channel.enabled ? "On" : "Off"}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Retention">
              {settings.retention.length === 0 ? (
                <p className="text-sm text-dim">Not configured</p>
              ) : null}
              <ul className="divide-y divide-line">
                {settings.retention.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <span className="text-dim">{item.label}</span>
                    <span className="text-ink">{item.value}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel
              title="Delete project"
              description="Removes the project, its API key, scans, assets, alerts and all telemetry. This cannot be undone."
              className="border-danger/30"
              action={
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setDeleting(true)}
                  disabled={others.length === 0}
                >
                  Delete project
                </Button>
              }
            >
              {others.length === 0 ? (
                <p className="text-xs text-mute">
                  This is your only project. Create another one before deleting
                  it.
                </p>
              ) : (
                <p className="text-xs text-mute">
                  Apps that still send data with this project's key will get
                  rejected.
                </p>
              )}
            </Panel>
            <Panel
              title="Density"
              description="Compact tightens the page padding and KPI type."
            >
              <div className="flex gap-2">
                {(["comfortable", "compact"] as Density[]).map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant={density === option ? "secondary" : "ghost"}
                    onClick={() => setDensity(option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </Panel>
          </div>
          <Dialog
            open={deleting}
            onOpenChange={(open) => {
              if (remove.isPending) return;
              setDeleting(open);
              if (!open) setConfirmName("");
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete {settings.project.name}?</DialogTitle>
                <DialogDescription>
                  This permanently removes the project and everything stored for
                  it. Old scan reports and metrics cannot be recovered.
                </DialogDescription>
              </DialogHeader>
              <div className="flex gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-ink">
                <TriangleAlert
                  className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                  aria-hidden
                />
                <p>
                  Type <strong>{settings.project.name}</strong> to confirm.
                </p>
              </div>
              <Input
                className="mt-3"
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={settings.project.name}
                aria-label="Type the project name to confirm"
                autoComplete="off"
              />
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDeleting(false)}
                  disabled={remove.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={
                    remove.isPending ||
                    confirmName.trim() !== settings.project.name.trim()
                  }
                  onClick={() => remove.mutate(scope.project)}
                >
                  {remove.isPending ? "Deleting..." : "Delete forever"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <ConnectDialog
            open={!!revealed}
            onOpenChange={(open) => !open && setRevealed(null)}
            title="Your new API key"
            description="This is the only time the full key is shown. The previous key no longer works."
            serviceName={settings.project.name}
            apiKey={revealed ?? ""}
          />
        </div>
      )}
    </QueryGate>
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
      {done ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      Copy
    </Button>
  );
}
