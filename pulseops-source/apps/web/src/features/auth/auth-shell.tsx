import {
  Activity,
  Bell,
  GitBranch,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/layout/logo";

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

/** The shared frame for the sign-in and sign-up pages: aurora background, pitch on the left, form on the right. */
export function AuthShell({ children }: { children: ReactNode }) {
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

        {children}
      </div>
    </div>
  );
}
