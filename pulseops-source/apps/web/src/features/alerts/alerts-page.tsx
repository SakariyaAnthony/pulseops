import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusBadge } from "@/components/shared/status-badge";
import { QueryGate } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { RuleDialog } from "@/features/alerts/rule-dialog";
import { useIncidentsQuery, useRulesQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import type { RuleInput } from "@/lib/api/types";
import { formatRelative } from "@/lib/format";

export function AlertsPage() {
  const scope = useScope();
  const rules = useRulesQuery();
  const incidents = useIncidentsQuery();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.title = "Alerts · PulseOps";
  }, []);

  const invalidate = () => {
    void client.invalidateQueries({ queryKey: ["rules"] });
    void client.invalidateQueries({ queryKey: ["incidents"] });
  };

  const toggle = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => api.toggleRule(scope.project, input.id, input.enabled),
    onSuccess: () => {
      invalidate();
      toast.success("Rule updated");
    },
    onError: () => toast.error("Couldn’t update the rule"),
  });

  const ack = useMutation({
    mutationFn: (id: string) => api.ack(id),
    onSuccess: () => {
      invalidate();
      toast.success("Incident acknowledged");
    },
  });

  const create = useMutation({
    mutationFn: (input: RuleInput) => api.createRule(scope.project, input),
    onSuccess: () => {
      invalidate();
      toast.success("Rule created");
    },
  });

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          eyebrow={scope.project}
          title="Alerts"
          description="Threshold rules and the incident timeline. Acknowledge a firing incident to stop the page from treating it as active."
        />
        <Button className="mb-5" onClick={() => setOpen(true)}>
          New rule
        </Button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <QueryGate query={rules} skeleton={<Skeleton className="h-64" />}>
          {(items) => (
            <Panel title="Rules" description="Project scoped. Incidents below follow the environment.">
              {items.length === 0 ? <p className="text-sm text-dim">No rules yet.</p> : null}
              <ul className="space-y-3">
                {items.map((rule) => (
                  <li key={rule.id} className="flex items-center justify-between gap-3 rounded-xl2 border border-line bg-base/40 px-3 py-3">
                    <div>
                      <p className="text-sm text-ink">{rule.name}</p>
                      <p className="mt-1 text-xs text-mute">
                        {rule.metric} {rule.operator} {rule.threshold} for {rule.window} · {rule.channels.join(", ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={rule.severity} />
                      <Switch
                        checked={rule.enabled}
                        aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                        onCheckedChange={(enabled) => toggle.mutate({ id: rule.id, enabled })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </QueryGate>
        <QueryGate
          query={incidents}
          skeleton={<Skeleton className="h-64" />}
          isEmpty={(items) => items.length === 0}
          empty={
            <Panel title="Incidents">
              <p className="text-sm text-dim">No incidents in {scope.env}. Prod on shop-api has two firing right now.</p>
            </Panel>
          }
        >
          {(items) => (
            <Panel title="Incidents">
              <ol className="space-y-4 border-l border-line pl-4">
                {items.map((incident) => (
                  <li key={incident.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-violet" />
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm text-ink">{incident.title}</p>
                        <p className="mt-1 text-xs leading-5 text-dim">{incident.detail}</p>
                        <p className="mt-1 text-[11px] text-mute">
                          {incident.service} · {formatRelative(incident.startedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={incident.status} />
                        {incident.status === "firing" ? (
                          <Button size="sm" variant="secondary" onClick={() => ack.mutate(incident.id)} disabled={ack.isPending}>
                            Acknowledge
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Panel>
          )}
        </QueryGate>
      </div>
      <RuleDialog
        open={open}
        onOpenChange={setOpen}
        onCreate={async (input) => {
          await create.mutateAsync(input);
        }}
      />
    </div>
  );
}
