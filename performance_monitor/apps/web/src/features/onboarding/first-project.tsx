import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FolderPlus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConnectDialog } from "@/features/settings/connect-snippet";
import { api } from "@/lib/api/client";
import { useSession } from "@/store/session";

type Created = { slug: string; name: string; apiKey: string };

/** Shown to an account that has no project yet, in place of every page that needs one. */
export function FirstProject() {
  const name = useSession((state) => state.name);
  const client = useQueryClient();
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("");
  const [created, setCreated] = useState<Created | null>(null);
  const first = (name ?? "").split(" ")[0];

  const create = useMutation({
    mutationFn: () =>
      api.createProject(projectName.trim(), {
        repositoryPath: "",
        framework: "",
        baseUrl: "",
        routes: ["/"],
        viewportWidth: 1280,
        viewportHeight: 800,
        timeoutMs: 15000,
        startCommand: "",
      }),
    onSuccess: (project) => setCreated(project),
  });

  const finish = async () => {
    if (!created) return;
    await client.invalidateQueries({ queryKey: ["projects"] });
    navigate(
      `/scans?project=${encodeURIComponent(created.slug)}&env=prod&range=1h`,
      { replace: true },
    );
  };

  return (
    <div className="mx-auto mt-10 max-w-lg">
      <div className="glass shadow-card rounded-2xl p-7">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-violet to-cyan/70 text-white shadow-glow">
          <FolderPlus className="h-5 w-5" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink">
          {first ? `Welcome, ${first}` : "Welcome to PulseOps"}
        </h1>
        <p className="mt-1.5 text-sm leading-6 text-dim">
          A project is one app you want to watch. Give it a name to get an
          ingest key and a place for its scans, API calls and Web Vitals. You
          can add the repository path and app address next.
        </p>
        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (projectName.trim()) create.mutate();
          }}
        >
          <label className="grid gap-1.5">
            <Label htmlFor="first-project">Project name</Label>
            <Input
              id="first-project"
              placeholder="My React app"
              value={projectName}
              maxLength={120}
              onChange={(event) => setProjectName(event.target.value)}
              autoFocus
            />
          </label>
          {create.isError ? (
            <p
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {create.error instanceof Error
                ? create.error.message
                : "The project was not created."}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            disabled={!projectName.trim() || create.isPending}
          >
            {create.isPending ? "Creating..." : "Create project"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </form>
      </div>
      {created ? (
        <ConnectDialog
          open
          onOpenChange={(open) => {
            if (!open) void finish();
          }}
          title={`${created.name} is ready`}
          description="Copy this key now. It is shown once. You can generate another in Settings. Next you will add your repository path and app address on the Assets page."
          serviceName={created.name}
          apiKey={created.apiKey}
        />
      ) : null}
    </div>
  );
}
