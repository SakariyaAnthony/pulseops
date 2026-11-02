import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, Lock, Mail, User } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/features/auth/auth-shell";
import { api } from "@/lib/api/client";
import { useSession } from "@/store/session";

const schema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Enter your name")
      .max(120, "Use 120 characters or fewer"),
    email: z.string().trim().email("Enter a valid email"),
    password: z
      .string()
      .min(8, "Use at least 8 characters")
      .max(128, "Use 128 characters or fewer"),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: "The passwords do not match",
  });

type Values = z.infer<typeof schema>;

function strength(password: string): {
  label: string;
  width: string;
  tone: string;
} {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length === 0) return { label: "", width: "0%", tone: "bg-mute" };
  if (score <= 1) return { label: "Weak", width: "25%", tone: "bg-danger" };
  if (score === 2) return { label: "Fair", width: "50%", tone: "bg-warning" };
  if (score === 3) return { label: "Good", width: "75%", tone: "bg-success" };
  return { label: "Strong", width: "100%", tone: "bg-success" };
}

export function RegisterPage() {
  const token = useSession((state) => state.token);
  const setSession = useSession((state) => state.setSession);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", email: "", password: "", confirm: "" },
  });
  const password = useWatch({ control: form.control, name: "password" });
  const meter = strength(password ?? "");

  if (token) return <Navigate to="/overview" replace />;

  const submit = async (values: Values) => {
    setError(null);
    try {
      const session = await api.register(
        values.name,
        values.email,
        values.password,
      );
      setSession(session);
      // A new account has no projects. The app shell takes it to "create your first project".
      navigate("/overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sign-up failed");
    }
  };

  const field = (
    id: "name" | "email" | "password" | "confirm",
    label: string,
    icon: React.ReactNode,
    props: React.ComponentProps<typeof Input>,
  ) => (
    <label className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {icon}
        <Input
          id={id}
          className="pl-10 pr-10"
          {...props}
          {...form.register(id)}
        />
        {id === "password" ? (
          <button
            type="button"
            onClick={() => setShow((value) => !value)}
            className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-mute hover:bg-white/[0.07] hover:text-ink"
            aria-label={show ? "Hide passwords" : "Show passwords"}
          >
            {show ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
        ) : null}
      </div>
      {form.formState.errors[id] ? (
        <p className="text-xs text-danger">
          {form.formState.errors[id]?.message}
        </p>
      ) : null}
    </label>
  );

  const iconClass =
    "pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute";

  return (
    <AuthShell>
      <form
        className="glass relative mx-auto w-full max-w-md rounded-2xl p-7 shadow-lift"
        onSubmit={form.handleSubmit(submit)}
        noValidate
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
          Create your account
        </h2>
        <p className="mt-1.5 text-sm leading-6 text-dim">
          Make a workspace of your own. You will add your first project right
          after.
        </p>

        <div className="mt-6 grid gap-4">
          {field(
            "name",
            "Full name",
            <User className={iconClass} aria-hidden />,
            {
              autoComplete: "name",
              placeholder: "Ada Lovelace",
            },
          )}
          {field("email", "Email", <Mail className={iconClass} aria-hidden />, {
            autoComplete: "email",
            placeholder: "you@company.com",
          })}
          <div>
            {field(
              "password",
              "Password",
              <Lock className={iconClass} aria-hidden />,
              {
                type: show ? "text" : "password",
                autoComplete: "new-password",
                placeholder: "At least 8 characters",
              },
            )}
            {password ? (
              <div className="mt-2" aria-live="polite">
                <div className="h-1 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full rounded-full transition-all ${meter.tone}`}
                    style={{ width: meter.width }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-mute">
                  Password strength: {meter.label}
                </p>
              </div>
            ) : null}
          </div>
          {field(
            "confirm",
            "Confirm password",
            <Lock className={iconClass} aria-hidden />,
            {
              type: show ? "text" : "password",
              autoComplete: "new-password",
              placeholder: "Repeat the password",
            },
          )}
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
          {form.formState.isSubmitting
            ? "Creating account..."
            : "Create account"}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Button>
        <p className="mt-5 text-center text-sm text-dim">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-violet underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
          >
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
