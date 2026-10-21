import { useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Settings2, TriangleAlert } from "lucide-react";
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
import { useProjectsQuery } from "@/hooks/queries";
import { api } from "@/lib/api/client";
import type { ScanSetup } from "@/lib/api/types";
import { cn } from "@/lib/utils";

export type SaveTarget = "current" | "new";
export type CreatedProject = { slug: string; name: string; apiKey: string };

/** Same rule as the API: names that slugify alike are the same project. */
function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="text-dim">{label}</span>
      <div className="mt-1">{children}</div>
      {hint ? (
        <span className="mt-1 block text-xs text-mute">{hint}</span>
      ) : null}
    </label>
  );
}

/** "/Users/me/Youtube-Clone" becomes "Youtube Clone". */
function nameFromPath(path: string): string {
  const folder =
    path.trim().replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "";
  return folder
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function blankSetup(from: ScanSetup): ScanSetup {
  return {
    ...from,
    repositoryPath: "",
    framework: "",
    baseUrl: "",
    routes: ["/"],
    startCommand: "",
  };
}

export function ScanSetupSheet({
  project,
  projectName,
  scan,
  open,
  onOpenChange,
  initialTarget = "current",
  onCreated,
}: {
  project: string;
  projectName: string;
  scan: ScanSetup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTarget?: SaveTarget;
  onCreated: (created: CreatedProject) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <Button size="sm" variant="secondary">
          <Settings2 className="h-3.5 w-3.5" />
          Edit setup
        </Button>
      </SheetTrigger>
      <SheetContent className="w-[min(480px,100vw)]">
        {/* Mounted only while open, so every open starts from the saved setup. */}
        <SetupForm
          project={project}
          projectName={projectName}
          scan={scan}
          initialTarget={initialTarget}
          onClose={() => onOpenChange(false)}
          onCreated={onCreated}
        />
      </SheetContent>
    </Sheet>
  );
}

function SetupForm({
  project,
  projectName,
  scan,
  initialTarget,
  onClose,
  onCreated,
}: {
  project: string;
  projectName: string;
  scan: ScanSetup;
  initialTarget: SaveTarget;
  onClose: () => void;
  onCreated: (created: CreatedProject) => void;
}) {
  const client = useQueryClient();
  const projects = useProjectsQuery();
  const [advanced, setAdvanced] = useState(false);
  const [target, setTarget] = useState<SaveTarget>(initialTarget);
  const [drafts, setDrafts] = useState<Record<SaveTarget, ScanSetup>>({
    current: scan,
    new: blankSetup(scan),
  });
  const [customName, setCustomName] = useState<string | null>(null);

  const draft = drafts[target];
  const setDraft = (next: ScanSetup) =>
    setDrafts((current) => ({ ...current, [target]: next }));
  const creating = target === "new";
  const name = customName ?? nameFromPath(drafts.new.repositoryPath);
  const cleaned = (value: ScanSetup): ScanSetup => ({
    ...value,
    routes: value.routes.map((route) => route.trim()).filter(Boolean),
  });

  const taken = creating
    ? (projects.data ?? []).find((item) => slugOf(item.name) === slugOf(name))
    : undefined;

  const savedPath = scan.repositoryPath.trim();
  const typedPath = drafts.current.repositoryPath.trim();
  const replacing =
    !creating &&
    savedPath !== "" &&
    typedPath !== "" &&
    typedPath !== savedPath;

  const save = useMutation({
    mutationFn: async () => {
      if (creating)
        return {
          created: await api.createProject(name.trim(), cleaned(draft)),
        };
      await api.saveScanConfig(project, cleaned(draft));
      return { created: null };
    },
    onSuccess: async ({ created }) => {
      if (created) {
        await client.invalidateQueries({ queryKey: ["projects"] });
        toast.success(`Created project ${created.name}`);
        onCreated(created);
        return;
      }
      await client.invalidateQueries({ queryKey: ["settings", project] });
      toast.success(`Scan setup saved to ${projectName}`);
      onClose();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const option = (id: SaveTarget, title: string, detail: string) => (
    <button
      key={id}
      type="button"
      role="radio"
      aria-checked={target === id}
      onClick={() => setTarget(id)}
      className={cn(
        "min-w-0 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet",
        target === id
          ? "border-violet bg-violet/10"
          : "border-line bg-elevated/40 hover:bg-white/5",
      )}
    >
      <span className="block text-sm font-medium text-ink">{title}</span>
      <span className="block truncate text-xs text-mute" title={detail}>
        {detail}
      </span>
    </button>
  );

  return (
    <>
      <SheetHeader>
        <SheetTitle>Scan setup</SheetTitle>
        <SheetDescription>
          Static scans use the repository. Runtime scans use the base URL and
          routes. Each project keeps its own setup.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">
            Save to
          </h3>
          <div
            role="radiogroup"
            aria-label="Save to"
            className="grid grid-cols-2 gap-2"
          >
            {option("current", "Current project", projectName)}
            {option("new", "New project", "Keeps the current one unchanged")}
          </div>
          {creating ? (
            <Field
              label="Project name"
              hint="Appears in the project dropdown. Filled in from the repository folder."
            >
              <Input
                value={name}
                placeholder="My app"
                onChange={(event) => setCustomName(event.target.value)}
              />
            </Field>
          ) : null}
          {taken ? (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-ink"
            >
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                aria-hidden
              />
              <p>
                A project named <strong>{taken.name}</strong> already exists (
                {taken.slug}). Use a different name, or switch to the current
                project to change its setup. Two projects with one name make the
                dropdown ambiguous and split your data.
              </p>
            </div>
          ) : null}
          {replacing ? (
            <div
              role="alert"
              className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-ink"
            >
              <TriangleAlert
                className="mt-0.5 h-4 w-4 shrink-0 text-warning"
                aria-hidden
              />
              <p>
                This replaces the setup for <strong>{projectName}</strong>,
                which currently points to{" "}
                <span className="break-all font-mono">{savedPath}</span>. Choose{" "}
                <strong>New project</strong> to keep both.
              </p>
            </div>
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">
            Static
          </h3>
          <Field
            label="Repository path"
            hint="Must be inside your home directory."
          >
            <Input
              value={draft.repositoryPath}
              placeholder="/absolute/path/to/app"
              onChange={(event) =>
                setDraft({ ...draft, repositoryPath: event.target.value })
              }
            />
          </Field>
          {draft.framework ? (
            <p className="text-xs text-mute">
              Detected framework: {draft.framework}
            </p>
          ) : null}
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-mute">
            Runtime
          </h3>
          <Field label="Base URL">
            <Input
              value={draft.baseUrl}
              placeholder="http://127.0.0.1:5173"
              onChange={(event) =>
                setDraft({ ...draft, baseUrl: event.target.value })
              }
            />
          </Field>
          <Field
            label="Routes"
            hint="One path per line, such as / and /checkout."
          >
            <textarea
              className="min-h-24 w-full rounded-lg border border-line bg-base/70 px-3 py-2 text-sm text-ink outline-none placeholder:text-mute focus-visible:ring-2 focus-visible:ring-violet"
              value={draft.routes.join("\n")}
              placeholder={"/\n/checkout"}
              onChange={(event) =>
                setDraft({ ...draft, routes: event.target.value.split("\n") })
              }
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
            <ChevronDown
              className={`h-4 w-4 transition-transform ${advanced ? "rotate-180" : ""}`}
            />
          </button>
          {advanced ? (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Width">
                  <Input
                    inputMode="numeric"
                    value={String(draft.viewportWidth)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        viewportWidth: Number(event.target.value) || 1280,
                      })
                    }
                  />
                </Field>
                <Field label="Height">
                  <Input
                    inputMode="numeric"
                    value={String(draft.viewportHeight)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        viewportHeight: Number(event.target.value) || 720,
                      })
                    }
                  />
                </Field>
                <Field label="Timeout ms">
                  <Input
                    inputMode="numeric"
                    value={String(draft.timeoutMs)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        timeoutMs: Number(event.target.value) || 15000,
                      })
                    }
                  />
                </Field>
              </div>
              <Field
                label="Start command"
                hint="Stored only. PulseOps does not run it."
              >
                <Input
                  value={draft.startCommand}
                  placeholder="npm run dev"
                  onChange={(event) =>
                    setDraft({ ...draft, startCommand: event.target.value })
                  }
                />
              </Field>
            </div>
          ) : null}
        </section>
      </SheetBody>
      <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
        <p className="min-w-0 truncate text-xs text-mute">
          {creating ? "Creates a new project" : `Saving to ${projectName}`}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              save.isPending ||
              (creating && (name.trim() === "" || Boolean(taken)))
            }
            onClick={() => save.mutate()}
          >
            {save.isPending
              ? "Saving…"
              : creating
                ? "Create project"
                : "Save setup"}
          </Button>
        </div>
      </div>
    </>
  );
}
