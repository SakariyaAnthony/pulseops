import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { InlineError } from "@/components/shared/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useProfileQuery, useProjectsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { api } from "@/lib/api/client";
import { formatRelative } from "@/lib/format";
import { withScope } from "@/lib/scope";
import { useSession } from "@/store/session";

const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name")
    .max(120, "Use 120 characters or fewer"),
});

const passwordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(128, "Use 128 characters or fewer"),
    confirm: z.string(),
  })
  .refine((values) => values.next === values.confirm, {
    path: ["confirm"],
    message: "The passwords do not match",
  })
  .refine((values) => values.next !== values.current, {
    path: ["next"],
    message: "Choose a password you are not using now",
  });

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function when(value: string, relative = false): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "—";
  return relative
    ? formatRelative(time)
    : new Date(time).toLocaleDateString(undefined, { dateStyle: "long" });
}

export function ProfilePage() {
  const profile = useProfileQuery();
  const projects = useProjectsQuery();
  const scope = useScope();
  const navigate = useNavigate();
  const clear = useSession((state) => state.clear);

  useEffect(() => {
    document.title = "Profile · PulseOps";
  }, []);

  if (profile.isLoading) return <Skeleton className="h-96" />;
  if (profile.isError || !profile.data) {
    return (
      <InlineError
        title="Could not load your profile"
        message={
          profile.error instanceof Error
            ? profile.error.message
            : "The API did not respond."
        }
        onRetry={() => void profile.refetch()}
        pending={profile.isFetching}
      />
    );
  }
  const user = profile.data;
  const list = projects.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Account"
        title="Profile"
        description="Your details, the projects you own, and your password."
      />

      <section className="glass shadow-card flex flex-wrap items-center gap-5 rounded-xl2 p-5">
        <Avatar className="h-16 w-16 text-lg">
          <AvatarFallback className="bg-gradient-to-br from-violet to-violet/60 text-xl font-semibold text-white">
            {initials(user.name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold tracking-tight text-ink">
            {user.name}
          </p>
          <p className="truncate text-sm text-dim">{user.email}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full border border-violet/30 bg-violet/10 px-2.5 py-0.5 font-semibold uppercase tracking-[0.12em] text-violet">
              {user.role === "admin" ? (
                <ShieldCheck className="h-3 w-3" aria-hidden />
              ) : null}
              {user.role}
            </span>
            <span
              className={
                user.isActive
                  ? "rounded-full border border-success/30 bg-success/10 px-2.5 py-0.5 text-success"
                  : "rounded-full border border-danger/30 bg-danger/10 px-2.5 py-0.5 text-danger"
              }
            >
              {user.isActive ? "Active" : "Disabled"}
            </span>
          </div>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            clear();
            navigate("/login");
          }}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </Button>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailsPanel key={user.name} name={user.name} />
        <Panel
          title="Account"
          description="Read-only facts about this account."
        >
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <Fact label="Email" value={user.email} />
            <Fact
              label="Role"
              value={user.role === "admin" ? "Admin" : "Member"}
            />
            <Fact label="Member since" value={when(user.createdAt)} />
            <Fact label="Last sign-in" value={when(user.lastLoginAt, true)} />
            <Fact
              label="Projects owned"
              value={String(list.length || user.projectCount)}
            />
          </dl>
          {user.role === "admin" ? (
            <p className="mt-4 text-xs leading-5 text-mute">
              You are an admin.{" "}
              <Link
                to={withScope("/users", scope)}
                className="text-violet underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
              >
                Manage users
              </Link>
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Your projects"
        description="Projects you own. Each one has its own scans, keys and metrics."
      >
        {list.length === 0 ? (
          <p className="text-sm text-dim">No projects yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((project) => (
              <li
                key={project.slug}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate text-ink">
                    {project.name}
                  </span>
                  <span className="block truncate text-xs text-mute">
                    {project.slug}
                  </span>
                </span>
                <Link
                  to={withScope("/overview", {
                    ...scope,
                    project: project.slug,
                  })}
                  className="shrink-0 text-xs text-violet underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <PasswordPanel />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-mute">
        {label}
      </dt>
      <dd className="truncate text-ink" title={value}>
        {value}
      </dd>
    </div>
  );
}

function DetailsPanel({ name }: { name: string }) {
  const client = useQueryClient();
  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name },
  });
  const save = useMutation({
    mutationFn: (values: z.infer<typeof nameSchema>) =>
      api.updateProfile(values.name),
    onSuccess: async (user) => {
      const current = useSession.getState();
      if (current.token)
        current.setSession({
          token: current.token,
          email: user.email,
          name: user.name,
          role: user.role,
        });
      await client.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Profile saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const dirty = form.formState.isDirty;
  return (
    <Panel
      title="Details"
      description="This name shows in the account menu and on the Users page."
    >
      <form
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
        noValidate
      >
        <label className="grid gap-1.5">
          <Label htmlFor="profile-name">Full name</Label>
          <Input
            id="profile-name"
            autoComplete="name"
            {...form.register("name")}
          />
          {form.formState.errors.name ? (
            <p className="text-xs text-danger">
              {form.formState.errors.name.message}
            </p>
          ) : null}
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving..." : "Save changes"}
          </Button>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => form.reset({ name })}
            >
              Discard
            </Button>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}

function PasswordPanel() {
  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", next: "", confirm: "" },
  });
  const change = useMutation({
    mutationFn: (values: z.infer<typeof passwordSchema>) =>
      api.changePassword(values.current, values.next),
    onSuccess: () => {
      form.reset();
      toast.success("Password changed. Use the new one next time you sign in.");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const field = (
    id: "current" | "next" | "confirm",
    label: string,
    autoComplete: string,
  ) => (
    <label className="grid gap-1.5">
      <Label htmlFor={`pw-${id}`}>{label}</Label>
      <Input
        id={`pw-${id}`}
        type="password"
        autoComplete={autoComplete}
        {...form.register(id)}
      />
      {form.formState.errors[id] ? (
        <p className="text-xs text-danger">
          {form.formState.errors[id]?.message}
        </p>
      ) : null}
    </label>
  );
  return (
    <Panel
      title="Password"
      description="Use at least 8 characters. Other places you are signed in stay signed in until their session ends."
    >
      <form
        className="grid max-w-md gap-4"
        onSubmit={form.handleSubmit((values) => change.mutate(values))}
        noValidate
      >
        {field("current", "Current password", "current-password")}
        {field("next", "New password", "new-password")}
        {field("confirm", "Confirm new password", "new-password")}
        <div>
          <Button type="submit" disabled={change.isPending}>
            <KeyRound className="h-4 w-4" aria-hidden />
            {change.isPending ? "Changing..." : "Change password"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
