import { zodResolver } from "@hookform/resolvers/zod";
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

export function LoginPage() {
  const token = useSession((state) => state.token);
  const setSession = useSession((state) => state.setSession);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  if (token) return <Navigate to="/overview?project=shop-api&env=prod&range=1h" replace />;

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
    <div className="relative min-h-screen">
      <div className="aurora" aria-hidden />
      <div className="relative z-10 mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-2">
        <div className="hidden lg:block">
          <div className="flex items-center gap-3">
            <Logo />
            <p className="text-sm font-semibold tracking-tight">PulseOps</p>
          </div>
          <h1 className="mt-8 max-w-md text-4xl font-semibold tracking-tight text-ink">See the slow path before your users do.</h1>
          <ul className="mt-6 max-w-md space-y-3 text-sm leading-6 text-dim">
            <li>p95, throughput, and error rate on one glass surface.</li>
            <li>Route drill-down with deploy markers and a time split.</li>
            <li>Threshold alerts for the shop-api workspace.</li>
          </ul>
        </div>
        <form
          className="glass shadow-card mx-auto w-full max-w-md rounded-xl2 p-6"
          onSubmit={form.handleSubmit(submit)}
        >
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <Logo />
            <p className="font-semibold">PulseOps</p>
          </div>
          <h2 className="text-lg font-semibold text-ink">Sign in</h2>
          <p className="mt-1 text-sm text-dim">Use the shop-api demo workspace, or your PulseOps account when the API is up.</p>
          <div className="mt-5 grid gap-3">
            <label className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" autoComplete="username" {...form.register("email")} />
              {form.formState.errors.email ? <p className="text-xs text-danger">{form.formState.errors.email.message}</p> : null}
            </label>
            <label className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} />
              {form.formState.errors.password ? <p className="text-xs text-danger">{form.formState.errors.password.message}</p> : null}
            </label>
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <Button type="submit" className="mt-5 w-full" disabled={form.formState.isSubmitting}>
            Sign in
          </Button>
          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-left text-xs text-dim hover:bg-white/5"
            onClick={() => {
              form.setValue("email", "demo@pulseops.dev");
              form.setValue("password", "pulseops-demo");
              void form.handleSubmit(submit)();
            }}
          >
            <span className="block text-sm text-ink">Enter demo workspace</span>
            demo@pulseops.dev · pulseops-demo
          </button>
          <p className="mt-4 text-[11px] text-mute">API {apiBase()}. If it is down, the dashboard replays demo telemetry.</p>
        </form>
      </div>
    </div>
  );
}
