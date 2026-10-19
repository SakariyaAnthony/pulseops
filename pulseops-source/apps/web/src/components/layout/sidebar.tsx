import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Logo } from "@/components/layout/logo";
import { NAV } from "@/components/layout/nav-items";
import { Tooltip } from "@/components/ui/tooltip";
import { useScope } from "@/hooks/use-scope";
import { withScope } from "@/lib/scope";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

export function Sidebar({ alertCount = 0, onNavigate }: { alertCount?: number; onNavigate?: () => void }) {
  const collapsed = useUi((state) => state.collapsed);
  const toggle = useUi((state) => state.toggleCollapsed);
  const source = useUi((state) => state.source);
  const scope = useScope();
  const groups = ["Monitor", "Detect", "Configure"];

  return (
    <div className={cn("flex h-full flex-col border-r border-line bg-base/80 backdrop-blur-xl", collapsed ? "w-16" : "w-60")}>
      <div className={cn("flex h-14 items-center gap-2 border-b border-line px-3", collapsed && "justify-center")}>
        <Logo />
        {collapsed ? null : (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-ink">PulseOps</p>
            <p className="truncate text-[11px] text-mute">Performance</p>
          </div>
        )}
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-3" aria-label="Primary">
        {groups.map((group) => (
          <div key={group}>
            {collapsed ? null : <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.16em] text-mute">{group}</p>}
            <ul className="space-y-1">
              {NAV.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                const link = (
                  <NavLink
                    to={withScope(item.to, scope)}
                    onClick={onNavigate}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "relative flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-dim transition-colors hover:bg-white/5 hover:text-ink",
                        collapsed && "justify-center px-0",
                        isActive && "bg-violet/10 text-ink shadow-[inset_2px_0_0_#7C5CFF]",
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {collapsed ? null : <span className="truncate">{item.label}</span>}
                    {!collapsed && item.soon ? <span className="ml-auto text-[10px] uppercase tracking-wide text-mute">Soon</span> : null}
                    {!collapsed && item.to === "/alerts" && alertCount > 0 ? (
                      <span className="ml-auto rounded-full bg-danger/20 px-1.5 text-[10px] font-medium text-danger">{alertCount}</span>
                    ) : null}
                  </NavLink>
                );
                return (
                  <li key={item.to}>
                    {collapsed ? <Tooltip content={item.label}>{link}</Tooltip> : link}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-line p-2">
        {collapsed ? null : (
          <p className="px-2 pb-2 text-[11px] text-mute">{source === "api" ? "Live API" : "Demo data"}</p>
        )}
        <button
          type="button"
          onClick={toggle}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs text-dim hover:bg-white/5 hover:text-ink"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          {collapsed ? null : "Collapse"}
        </button>
      </div>
    </div>
  );
}
