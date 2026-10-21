import { zodResolver } from "@hookform/resolvers/zod";
import {
  Activity,
  ArrowRight,
  Bell,
  Eye,
  EyeOff,
  GitBranch,
  Lock,
  Mail,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, apiBase } from "@/lib/api/client";
import { useSession } from "@/store/session";

const schema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type Values = z.infer<typeof schema>;

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Activity,
    title: "Live performance",
    body: "p95, throughput and error rate on one surface.",
  },
  {
    icon: GitBranch,
    title: "Route drill-down",
    body: "Deploy markers and a time split for every route.",
  },
  {
    icon: Bell,
    title: "Threshold alerts",
    body: "Get told before a slow path reaches your users.",
  },
];

export function LoginPage() {
  const token = useSession((state) => state.token);
  const setSession = useSession((state) => state.setSession);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  if (token)
    return (
      <Navigate to="/overview?project=shop-api&env=prod&range=1h" replace />
    );

  const submit = async (values: Values) => {
    setError(null);
    try {
      const session = await api.login(values.email, values.password);
      setSession(session);
      navigate("/overview?project=shop-api&env=prod&range=1h");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-in failed");
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="aurora" aria-hidden />
      <div
        className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-violet/20 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-24 bottom-10 h-72 w-72 rounded-full bg-cyan/15 blur-3xl"
        aria-hidden
      />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-5 py-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="hidden lg:block">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div
                className="absolute inset-0 rounded-xl bg-violet/40 blur-md"
                aria-hidden
              />
              <Logo className="relative h-10 w-10 rounded-xl ring-1 ring-white/10" />
            </div>
            <p className="text-base font-semibold tracking-tight text-ink">
              PulseOps
            </p>
          </div>
          <p className="mt-10 inline-flex items-center gap-2 rounded-full border border-violet/25 bg-violet/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet">
            <Sparkles className="h-3 w-3" aria-hidden />
            Performance monitoring
          </p>
          <h1 className="gradient-text mt-4 max-w-lg text-5xl font-semibold leading-[1.08] tracking-tight">
            See the slow path before your users do.
          </h1>
          <ul className="mt-10 grid max-w-md gap-3">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li
                key={title}
                className="glass flex items-center gap-4 rounded-xl2 p-4"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet to-violet/60 text-white shadow-glow">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">{title}</p>
                  <p className="text-xs leading-5 text-dim">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <form
          className="glass relative mx-auto w-full max-w-md rounded-2xl p-7 shadow-lift"
          onSubmit={form.handleSubmit(submit)}
        >
          <div
            className="pointer-events-none absolute inset-x-8 -top-px h-px bg-gradient-to-r from-transparent via-violet to-transparent"
            aria-hidden
          />
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <Logo className="h-9 w-9 rounded-xl" />
            <p className="font-semibold">PulseOps</p>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-ink">
            Welcome back
          </h2>
          <p className="mt-1.5 text-sm leading-6 text-dim">
            Sign in with your PulseOps account, or open the shop-api demo
            workspace.
          </p>

          <div className="mt-6 grid gap-4">
            <label className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
                  aria-hidden
                />
                <Input
                  id="email"
                  autoComplete="username"
                  placeholder="you@company.com"
                  className="pl-10"
                  {...form.register("email")}
                />
              </div>
              {form.formState.errors.email ? (
                <p className="text-xs text-danger">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </label>
            <label className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
                  aria-hidden
                />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  className="pl-10 pr-10"
                  {...form.register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-mute hover:bg-white/[0.07] hover:text-ink"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {form.formState.errors.password ? (
                <p className="text-xs text-danger">
                  {form.formState.errors.password.message}
                </p>
              ) : null}
            </label>
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="mt-6 w-full"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "Signing in..." : "Sign in"}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>

          <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-mute">
            <span className="h-px flex-1 bg-white/[0.08]" />
            or
            <span className="h-px flex-1 bg-white/[0.08]" />
          </div>

          <button
            type="button"
            className="group flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-left transition-colors hover:border-violet/40 hover:bg-violet/10"
            onClick={() => {
              form.setValue("email", "demo@pulseops.dev");
              form.setValue("password", "pulseops-demo");
              void form.handleSubmit(submit)();
            }}
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-violet group-hover:bg-violet group-hover:text-white">
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">
                Enter demo workspace
              </span>
              <span className="block truncate text-xs text-mute">
                demo@pulseops.dev · pulseops-demo
              </span>
            </span>
            <ArrowRight
              className="h-4 w-4 text-mute transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
              aria-hidden
            />
          </button>
          <p className="mt-5 text-center text-[11px] text-mute">
            API {apiBase()}. If it is down, the dashboard replays demo
            telemetry.
          </p>
        </form>
      </div>
    </div>
  );
}
