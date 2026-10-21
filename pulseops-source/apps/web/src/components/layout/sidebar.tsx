import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Logo } from "@/components/layout/logo";
import { NAV } from "@/components/layout/nav-items";
import { Tooltip } from "@/components/ui/tooltip";
import { useScope } from "@/hooks/use-scope";
import { withScope } from "@/lib/scope";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

const GROUPS = ["Monitor", "Scan", "Detect", "Configure"];

/**
 * Floating glass sidebar. On desktop it sits inset from the screen edge as a rounded panel.
 * Inside the mobile sheet (`onNavigate` is set) it fills the sheet and is never collapsed.
 */
export function Sidebar({
  alertCount = 0,
  onNavigate,
}: {
  alertCount?: number;
  onNavigate?: () => void;
}) {
  const storedCollapsed = useUi((state) => state.collapsed);
  const toggle = useUi((state) => state.toggleCollapsed);
  const source = useUi((state) => state.source);
  const scope = useScope();
  const reduceMotion = useReducedMotion();
  const inSheet = Boolean(onNavigate);
  const collapsed = storedCollapsed && !inSheet;
  const live = source === "api";

  return (
    <LayoutGroup id={inSheet ? "nav-sheet" : "nav-desktop"}>
      <div className={cn("h-full", inSheet ? "" : "p-3 pr-0")}>
        <div
          className={cn(
            "relative flex h-full flex-col overflow-hidden bg-gradient-to-b from-elevated/80 via-surface/70 to-base/80 backdrop-blur-2xl transition-[width] duration-200",
            inSheet
              ? "w-full border-r border-line"
              : cn(
                  "rounded-2xl border border-white/[0.07] shadow-card",
                  collapsed ? "w-[68px]" : "w-[236px]",
                ),
          )}
        >
          <div
            className="pointer-events-none absolute -top-20 left-1/2 h-44 w-44 -translate-x-1/2 rounded-full bg-violet/25 blur-3xl"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -bottom-24 -right-10 h-40 w-40 rounded-full bg-cyan/10 blur-3xl"
            aria-hidden
          />

          <div
            className={cn(
              "relative flex h-16 items-center gap-3 px-4",
              collapsed && "justify-center px-0",
            )}
          >
            <div className="relative shrink-0">
              <div
                className="absolute inset-0 rounded-xl bg-violet/40 blur-md"
                aria-hidden
              />
              <Logo className="relative h-9 w-9 rounded-xl ring-1 ring-white/10" />
            </div>
            {collapsed ? null : (
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold tracking-tight text-ink">
                  PulseOps
                </p>
                <p className="truncate text-[11px] text-mute">Performance</p>
              </div>
            )}
          </div>

          <nav
            className="relative flex-1 space-y-3 overflow-y-auto px-3 pb-3 pt-0"
            aria-label="Primary"
          >
            {GROUPS.map((group, index) => (
              <div key={group}>
                {collapsed ? (
                  index > 0 ? (
                    <div
                      className="mx-2 mb-3 h-px bg-white/[0.06]"
                      aria-hidden
                    />
                  ) : null
                ) : (
                  <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-mute/80">
                    {group}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {NAV.filter((item) => item.group === group).map((item) => {
                    const Icon = item.icon;
                    const showBadge = item.to === "/alerts" && alertCount > 0;
                    const link = (
                      <NavLink
                        to={withScope(item.to, scope)}
                        onClick={onNavigate}
                        aria-label={collapsed ? item.label : undefined}
                        className={({ isActive }) =>
                          cn(
                            "group relative flex items-center gap-3 rounded-xl px-1.5 py-1 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet/60",
                            collapsed && "justify-center px-0",
                            isActive
                              ? "text-ink"
                              : "text-dim hover:bg-white/[0.04] hover:text-ink",
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive ? (
                              <motion.span
                                layoutId="nav-active"
                                transition={
                                  reduceMotion
                                    ? { duration: 0 }
                                    : {
                                        type: "spring",
                                        stiffness: 500,
                                        damping: 40,
                                      }
                                }
                                className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet/25 via-violet/10 to-transparent ring-1 ring-inset ring-violet/30"
                                aria-hidden
                              />
                            ) : null}
                            {isActive && !collapsed ? (
                              <span
                                className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-violet to-cyan shadow-glow"
                                aria-hidden
                              />
                            ) : null}
                            <span
                              className={cn(
                                "relative grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-all",
                                isActive
                                  ? "bg-gradient-to-br from-violet to-violet/70 text-white shadow-glow"
                                  : "bg-white/[0.04] text-dim group-hover:bg-white/10 group-hover:text-ink",
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              {collapsed && showBadge ? (
                                <span
                                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-danger ring-2 ring-base"
                                  aria-hidden
                                />
                              ) : null}
                            </span>
                            {collapsed ? null : (
                              <span className="relative truncate">
                                {item.label}
                              </span>
                            )}
                            {!collapsed && item.soon ? (
                              <span className="relative ml-auto rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-mute">
                                Soon
                              </span>
                            ) : null}
                            {!collapsed && showBadge ? (
                              <span className="relative ml-auto min-w-5 rounded-full bg-danger/20 px-1.5 text-center text-[10px] font-semibold text-danger ring-1 ring-inset ring-danger/30">
                                {alertCount}
                              </span>
                            ) : null}
                          </>
                        )}
                      </NavLink>
                    );
                    return (
                      <li key={item.to}>
                        {collapsed ? (
                          <Tooltip content={item.label}>{link}</Tooltip>
                        ) : (
                          link
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="relative space-y-2 border-t border-white/[0.06] p-3">
            <div
              className={cn(
                "flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-2.5 py-2",
                collapsed && "justify-center px-0",
              )}
              title={
                live ? "Connected to the PulseOps API" : "Showing demo data"
              }
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  live ? "animate-pulseRing bg-success" : "bg-warning",
                )}
                aria-hidden
              />
              {collapsed ? (
                <span className="sr-only">
                  {live ? "Live API" : "Demo data"}
                </span>
              ) : (
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-xs font-medium text-ink">
                    {live ? "Live API" : "Demo data"}
                  </p>
                  <p className="truncate text-[10px] text-mute">
                    {live ? "Receiving real traffic" : "API not reachable"}
                  </p>
                </div>
              )}
            </div>
            {inSheet ? null : (
              <button
                type="button"
                onClick={toggle}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-xs text-dim outline-none transition-colors hover:bg-white/[0.05] hover:text-ink focus-visible:ring-2 focus-visible:ring-violet/60",
                  collapsed && "justify-center px-0",
                )}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? (
                  <ChevronsRight className="h-4 w-4" />
                ) : (
                  <ChevronsLeft className="h-4 w-4" />
                )}
                {collapsed ? null : "Collapse"}
              </button>
            )}
          </div>
        </div>
      </div>
    </LayoutGroup>
  );
}
