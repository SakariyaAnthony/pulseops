import { Bell, Menu, RefreshCw, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/layout/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIncidentsQuery, useProjectsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { PROJECTS } from "@/lib/api/mock";
import { ENVIRONMENTS, TIME_RANGES } from "@/lib/api/types";
import { formatRelative } from "@/lib/format";
import { RANGE_LABEL, withScope } from "@/lib/scope";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";
import { cn } from "@/lib/utils";

const NEW_PROJECT = "__new_project__";

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
  const role = useSession((state) => state.role);
  const clear = useSession((state) => state.clear);
  // An account with no projects shows an empty list. The sample projects are only for the offline demo.
  const list = projects.isSuccess ? projects.data : PROJECTS;
  const nameCount = new Map<string, number>();
  for (const project of list)
    nameCount.set(project.name, (nameCount.get(project.name) ?? 0) + 1);
  const firing = (incidents.data ?? []).filter(
    (incident) => incident.status === "firing",
  );

  const rangeControl = (
    <div
      role="radiogroup"
      aria-label="Time range"
      className="flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-0.5"
    >
      {TIME_RANGES.map((range, index) => (
        <button
          key={range}
          type="button"
          role="radio"
          aria-checked={scope.range === range}
          title={`${RANGE_LABEL[range]} · Alt+${index + 1}`}
          onClick={() => scope.update({ range })}
          className={cn(
            "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
            scope.range === range
              ? "bg-gradient-to-b from-violet to-[#6a49ee] text-white shadow-glow"
              : "text-dim hover:bg-white/[0.06] hover:text-ink",
          )}
        >
          {range}
        </button>
      ))}
    </div>
  );

  const switches = (
    <>
      <Select
        value={scope.project}
        onValueChange={(project) => {
          if (project === NEW_PROJECT)
            navigate(withScope("/scans?setup=new", scope));
          else scope.update({ project });
        }}
      >
        <SelectTrigger className="w-40" aria-label="Project">
          <SelectValue>
            <span className="block truncate">
              {list.length === 0
                ? "No projects"
                : (list.find((project) => project.slug === scope.project)
                    ?.name ?? scope.project)}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {list.map((project) => (
            <SelectItem key={project.slug} value={project.slug}>
              {project.name}
              {(nameCount.get(project.name) ?? 0) > 1 ? (
                <span className="ml-1.5 text-xs text-mute">
                  · {project.slug}
                </span>
              ) : null}
            </SelectItem>
          ))}
          <SelectItem
            value={NEW_PROJECT}
            className="mt-1 border-t border-line pt-2 text-violet"
          >
            + New project
          </SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={scope.env}
        onValueChange={(env) => scope.update({ env: env as typeof scope.env })}
      >
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
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-base/70 backdrop-blur-2xl lg:top-3 lg:mx-3 lg:mt-3 lg:rounded-2xl lg:border lg:border-white/[0.08] lg:bg-surface/60 lg:shadow-card">
      <div className="flex h-14 items-center gap-2 px-3 lg:h-16 lg:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenu}
          aria-label="Open navigation"
        >
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
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-dim transition-colors hover:text-ink"
            aria-pressed={live}
            title={
              connected
                ? "Streaming from the API"
                : source === "api"
                  ? "API connected"
                  : "Demo stream"
            }
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                live ? "bg-success animate-pulseRing" : "bg-mute",
              )}
            />
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
          <Button
            variant="ghost"
            size="sm"
            className="hidden gap-2 border border-white/[0.08] bg-white/[0.03] sm:inline-flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="h-3.5 w-3.5" />
            Search
            <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 text-[10px] text-mute">
              ⌘K
            </kbd>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="relative"
                aria-label={`Alerts, ${firing.length} firing`}
              >
                <Bell className="h-4 w-4" />
                {firing.length > 0 ? (
                  <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" />
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-mute">
                Firing
              </p>
              {firing.length === 0 ? (
                <p className="text-sm text-dim">
                  No firing incidents in this environment.
                </p>
              ) : (
                <ul className="space-y-2">
                  {firing.map((incident) => (
                    <li key={incident.id}>
                      <button
                        type="button"
                        className="w-full rounded-xl px-2 py-1.5 text-left hover:bg-white/5"
                        onClick={() => navigate(withScope("/alerts", scope))}
                      >
                        <p className="text-sm text-ink">{incident.title}</p>
                        <p className="text-[11px] text-mute">
                          {incident.service} ·{" "}
                          {formatRelative(incident.startedAt)}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                aria-label="Account"
              >
                <Avatar>
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <span className="block truncate">{email ?? name}</span>
                {role ? (
                  <span className="block text-[10px] font-normal uppercase tracking-[0.14em] text-mute">
                    {role}
                  </span>
                ) : null}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => navigate(withScope("/profile", scope))}
              >
                Profile
              </DropdownMenuItem>
              {role === "admin" ? (
                <DropdownMenuItem
                  onSelect={() => navigate(withScope("/users", scope))}
                >
                  Users
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onSelect={() => navigate(withScope("/settings", scope))}
              >
                Settings
              </DropdownMenuItem>
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
