import { useNavigate } from "react-router-dom";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { NAV } from "@/components/layout/nav-items";
import { useProjectsQuery } from "@/hooks/queries";
import { PROJECTS } from "@/lib/api/mock";
import { ENVIRONMENTS, TIME_RANGES } from "@/lib/api/types";
import { RANGE_LABEL, withScope } from "@/lib/scope";
import { useScope } from "@/hooks/use-scope";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";

export function CommandPalette() {
  const open = useUi((state) => state.commandOpen);
  const setOpen = useUi((state) => state.setCommandOpen);
  const setLive = useUi((state) => state.setLive);
  const live = useUi((state) => state.live);
  const toggleCollapsed = useUi((state) => state.toggleCollapsed);
  const scope = useScope();
  const role = useSession((state) => state.role);
  const projects = useProjectsQuery();
  const navigate = useNavigate();
  const projectList = projects.isSuccess ? projects.data : PROJECTS;

  const go = (path: string) => {
    navigate(withScope(path, scope));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Jump to a view, project, environment, or time range.
        </DialogDescription>
        <Command>
          <CommandInput placeholder="Jump to a view, project, or range" />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup heading="Navigate">
              {NAV.filter((item) => !item.admin || role === "admin").map(
                (item) => (
                  <CommandItem
                    key={item.to}
                    value={item.label}
                    onSelect={() => go(item.to)}
                  >
                    {item.label}
                    {item.soon ? (
                      <span className="ml-auto text-[10px] uppercase text-mute">
                        Soon
                      </span>
                    ) : null}
                  </CommandItem>
                ),
              )}
            </CommandGroup>
            <CommandGroup heading="Time range">
              {TIME_RANGES.map((range) => (
                <CommandItem
                  key={range}
                  value={RANGE_LABEL[range]}
                  onSelect={() => {
                    scope.update({ range });
                    setOpen(false);
                  }}
                >
                  {RANGE_LABEL[range]}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Project">
              {projectList.map((project) => (
                <CommandItem
                  key={project.slug}
                  value={project.name}
                  onSelect={() => {
                    scope.update({ project: project.slug });
                    setOpen(false);
                  }}
                >
                  {project.name}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Environment">
              {ENVIRONMENTS.map((env) => (
                <CommandItem
                  key={env}
                  value={env}
                  onSelect={() => {
                    scope.update({ env });
                    setOpen(false);
                  }}
                >
                  {env}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem
                value="toggle live"
                onSelect={() => {
                  setLive(!live);
                  setOpen(false);
                }}
              >
                {live ? "Pause live refresh" : "Resume live refresh"}
              </CommandItem>
              <CommandItem
                value="toggle sidebar"
                onSelect={() => {
                  toggleCollapsed();
                  setOpen(false);
                }}
              >
                Toggle sidebar
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="border-t border-line px-3 py-2 text-[11px] text-mute">
            Alt+1 through Alt+5 change the time range · Esc closes
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
