import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "@/lib/api/client";
import type { ScanSetup } from "@/lib/api/types";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-dim">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? <span className="mt-1 block text-xs text-mute">{hint}</span> : null}
    </label>
  );
}

export function ScanSetupSheet({ project, scan }: { project: string; scan: ScanSetup }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [draft, setDraft] = useState(scan);

  const onOpenChange = (next: boolean) => {
    if (next) setDraft(scan);
    setOpen(next);
  };

  const save = useMutation({
    mutationFn: () =>
      api.saveScanConfig(project, {
        ...draft,
        routes: draft.routes.map((route) => route.trim()).filter(Boolean),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["settings", project] });
      toast.success("Scan settings saved");
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm" variant="secondary">
          <Settings2 className="h-3.5 w-3.5" />
          Edit setup
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(480px,100vw)]">
        <SheetHeader>
          <SheetTitle>Scan setup</SheetTitle>
          <SheetDescription>
            Static scans use the repository. Runtime scans use the base URL and routes.
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-6">
          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">Static</h3>
            <Field label="Repository path" hint="Must be inside your home directory.">
              <Input
                value={draft.repositoryPath}
                placeholder="/absolute/path/to/app"
                onChange={(event) => setDraft({ ...draft, repositoryPath: event.target.value })}
              />
            </Field>
            {draft.framework ? <p className="text-xs text-mute">Detected framework: {draft.framework}</p> : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">Runtime</h3>
            <Field label="Base URL">
              <Input
                value={draft.baseUrl}
                placeholder="http://127.0.0.1:5173"
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </Field>
            <Field label="Routes" hint="One path per line, such as / and /checkout.">
              <textarea
                className="min-h-24 w-full rounded-lg border border-line bg-base/70 px-3 py-2 text-sm text-ink outline-none placeholder:text-mute focus-visible:ring-2 focus-visible:ring-violet"
                value={draft.routes.join("\n")}
                placeholder={"/\n/checkout"}
                onChange={(event) => setDraft({ ...draft, routes: event.target.value.split("\n") })}
              />
            </Field>
          </section>

          <section>
            <button
              type="button"
              className="flex w-full items-center justify-between text-[11px] font-medium uppercase tracking-[0.16em] text-mute hover:text-ink"
              aria-expanded={advanced}
              onClick={() => setAdvanced((value) => !value)}
            >
              Advanced
              <ChevronDown className={`h-4 w-4 transition-transform ${advanced ? "rotate-180" : ""}`} />
            </button>
            {advanced ? (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Width">
                    <Input
                      inputMode="numeric"
                      value={String(draft.viewportWidth)}
                      onChange={(event) => setDraft({ ...draft, viewportWidth: Number(event.target.value) || 1280 })}
                    />
                  </Field>
                  <Field label="Height">
                    <Input
                      inputMode="numeric"
                      value={String(draft.viewportHeight)}
                      onChange={(event) => setDraft({ ...draft, viewportHeight: Number(event.target.value) || 720 })}
                    />
                  </Field>
                  <Field label="Timeout ms">
                    <Input
                      inputMode="numeric"
                      value={String(draft.timeoutMs)}
                      onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) || 15000 })}
                    />
                  </Field>
                </div>
                <Field label="Start command" hint="Stored only. PulseOps does not run it.">
                  <Input
                    value={draft.startCommand}
                    placeholder="npm run dev"
                    onChange={(event) => setDraft({ ...draft, startCommand: event.target.value })}
                  />
                </Field>
              </div>
            ) : null}
          </section>
        </SheetBody>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save setup"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
