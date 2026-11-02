import type { ReactNode } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RuleInput, Severity } from "@/lib/api/types";

const schema = z.object({
  name: z.string().min(3, "Name the rule"),
  metric: z.string().min(1),
  operator: z.enum(["above", "below"]),
  threshold: z.coerce.number().positive("Use a positive threshold"),
  window: z.string().min(1),
  severity: z.enum(["critical", "warning", "info"]),
  channels: z.array(z.string()).min(1, "Pick at least one channel"),
});

type FormValues = z.infer<typeof schema>;

const CHANNELS = [
  { id: "email", label: "Email" },
  { id: "slack", label: "Slack" },
  { id: "webhook", label: "Webhook" },
];

export function RuleDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: RuleInput) => Promise<void>;
}) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      metric: "p95 latency",
      operator: "above",
      threshold: 800,
      window: "5m",
      severity: "warning",
      channels: ["slack"],
    },
  });
  const channels = form.watch("channels");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New alert rule</DialogTitle>
          <DialogDescription>Threshold rules evaluate on rollups. Anomaly detection is later.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={form.handleSubmit(async (values) => {
            await onCreate(values);
            form.reset();
            onOpenChange(false);
          })}
        >
          <label className="grid gap-1.5">
            <Label htmlFor="rule-name">Name</Label>
            <Input id="rule-name" {...form.register("name")} />
            <FieldError message={form.formState.errors.name?.message} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldSelect label="Metric" value={form.watch("metric")} onChange={(metric) => form.setValue("metric", metric)}>
              {["p95 latency", "error rate", "CPU", "apdex", "throughput"].map((metric) => (
                <SelectItem key={metric} value={metric}>
                  {metric}
                </SelectItem>
              ))}
            </FieldSelect>
            <FieldSelect label="Operator" value={form.watch("operator")} onChange={(operator) => form.setValue("operator", operator as FormValues["operator"])}>
              <SelectItem value="above">above</SelectItem>
              <SelectItem value="below">below</SelectItem>
            </FieldSelect>
            <label className="grid gap-1.5">
              <Label htmlFor="threshold">Threshold</Label>
              <Input id="threshold" type="number" step="any" {...form.register("threshold")} />
              <FieldError message={form.formState.errors.threshold?.message} />
            </label>
            <FieldSelect label="Window" value={form.watch("window")} onChange={(window) => form.setValue("window", window)}>
              {["5m", "10m", "15m", "1h"].map((window) => (
                <SelectItem key={window} value={window}>
                  {window}
                </SelectItem>
              ))}
            </FieldSelect>
          </div>
          <FieldSelect
            label="Severity"
            value={form.watch("severity")}
            onChange={(severity) => form.setValue("severity", severity as Severity)}
          >
            <SelectItem value="critical">critical</SelectItem>
            <SelectItem value="warning">warning</SelectItem>
            <SelectItem value="info">info</SelectItem>
          </FieldSelect>
          <fieldset>
            <legend className="text-xs font-medium text-dim">Notify</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {CHANNELS.map((channel) => (
                <label key={channel.id} className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="accent-violet"
                    checked={channels.includes(channel.id)}
                    onChange={(event) => {
                      const next = event.target.checked ? [...channels, channel.id] : channels.filter((item) => item !== channel.id);
                      form.setValue("channels", next, { shouldValidate: true });
                    }}
                  />
                  {channel.label}
                </label>
              ))}
            </div>
            <FieldError message={form.formState.errors.channels?.message} />
          </fieldset>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Create rule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs text-dim">
      {label}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-danger">{message}</p>;
}
