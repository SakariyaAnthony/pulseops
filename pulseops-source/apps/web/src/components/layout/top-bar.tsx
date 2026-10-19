import { Bell, Menu, RefreshCw, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/layout/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useIncidentsQuery, useProjectsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { PROJECTS } from "@/lib/api/mock";
import { ENVIRONMENTS, TIME_RANGES } from "@/lib/api/types";
import { formatRelative } from "@/lib/format";
import { RANGE_LABEL, withScope } from "@/lib/scope";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

export function TopBar({
  connected,
  onMenu,
}: {
  connected: boolean;
  onMenu: () => void;
}) {
  const scope = useScope();
  const navigate = useNavigate();
  const client = useQueryClient();
  const projects = useProjectsQuery();
  const incidents = useIncidentsQuery();
  const live = useUi((state) => state.live);
  const setLive = useUi((state) => state.setLive);
  const setCommandOpen = useUi((state) => state.setCommandOpen);
  const source = useUi((state) => state.source);
  const name = useSession((state) => state.name) ?? "Operator";
  const email = useSession((state) => state.email);
  const clear = useSession((state) => state.clear);
  const list = projects.data?.length ? projects.data : PROJECTS;
  const firing = (incidents.data ?? []).filter((incident) => incident.status === "firing");

  const rangeControl = (
    <div role="radiogroup" aria-label="Time range" className="flex rounded-lg border border-line bg-base/60 p-0.5">
      {TIME_RANGES.map((range, index) => (
        <button
          key={range}
          type="button"
          role="radio"
          aria-checked={scope.range === range}
          title={`${RANGE_LABEL[range]} · Alt+${index + 1}`}
          onClick={() => scope.update({ range })}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium",
            scope.range === range ? "bg-violet text-white shadow-glow" : "text-dim hover:text-ink",
          )}
        >
          {range}
        </button>
      ))}
    </div>
  );

  const switches = (
    <>
      <Select value={scope.project} onValueChange={(project) => scope.update({ project })}>
        <SelectTrigger className="w-36" aria-label="Project">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {list.map((project) => (
            <SelectItem key={project.slug} value={project.slug}>
              {project.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={scope.env} onValueChange={(env) => scope.update({ env: env as typeof scope.env })}>
        <SelectTrigger className="w-28" aria-label="Environment">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ENVIRONMENTS.map((env) => (
            <SelectItem key={env} value={env}>
              {env}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-base/75 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-2 px-3 lg:px-5">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenu} aria-label="Open navigation">
          <Menu className="h-4 w-4" />
        </Button>
        <div className="mr-1 flex items-center gap-2 lg:hidden">
          <Logo className="h-7 w-7" />
        </div>
        <div className="hidden items-center gap-2 lg:flex">{switches}</div>
        <div className="hidden lg:block">{rangeControl}</div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setLive(!live)}
            className="inline-flex items-center gap-2 rounded-full border border-line bg-base/60 px-2.5 py-1 text-xs text-dim"
            aria-pressed={live}
            title={connected ? "Streaming from the API" : source === "api" ? "API connected" : "Demo stream"}
          >
            <span className={cn("h-2 w-2 rounded-full", live ? "bg-success animate-pulseRing" : "bg-mute")} />
            {live ? "Live" : "Paused"}
          </button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh"
            onClick={() => void client.invalidateQueries()}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setCommandOpen(true)}>
            <Search className="h-3.5 w-3.5" />
            Search
            <kbd className="rounded border border-line px-1 text-[10px] text-mute">⌘K</kbd>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label={`Alerts, ${firing.length} firing`}>
                <Bell className="h-4 w-4" />
                {firing.length > 0 ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-mute">Firing</p>
              {firing.length === 0 ? (
                <p className="text-sm text-dim">No firing incidents in this environment.</p>
              ) : (
                <ul className="space-y-2">
                  {firing.map((incident) => (
                    <li key={incident.id}>
                      <button
                        type="button"
                        className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
                        onClick={() => navigate(withScope("/alerts", scope))}
                      >
                        <p className="text-sm text-ink">{incident.title}</p>
                        <p className="text-[11px] text-mute">{incident.service} · {formatRelative(incident.startedAt)}</p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet" aria-label="Account">
                <Avatar>
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>{email ?? name}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate(withScope("/settings", scope))}>Settings</DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  clear();
                  navigate("/login");
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center gap-2 overflow-x-auto px-3 pb-2 lg:hidden">
        {switches}
        {rangeControl}
      </div>
    </header>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
