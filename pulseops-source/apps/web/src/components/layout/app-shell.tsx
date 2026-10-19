import { Suspense, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CommandPalette } from "@/components/layout/command-palette";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { PageSkeleton } from "@/components/shared/states";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIncidentsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { probeApi } from "@/lib/api/client";
import { TIME_RANGES } from "@/lib/api/types";
import { connectLive } from "@/lib/ws";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";

export function AppShell() {
  const [params] = useSearchParams();
  const scope = useScope();
  const update = scope.update;
  const [menu, setMenu] = useState(false);
  const [connected, setConnected] = useState(false);
  const token = useSession((state) => state.token);
  const live = useUi((state) => state.live);
  const density = useUi((state) => state.density);
  const setCommandOpen = useUi((state) => state.setCommandOpen);
  const commandOpen = useUi((state) => state.commandOpen);
  const client = useQueryClient();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const incidents = useIncidentsQuery();
  const firing = (incidents.data ?? []).filter((incident) => incident.status === "firing").length;

  useEffect(() => {
    if (!params.get("range") || !params.get("project") || !params.get("env")) update({});
  }, [params, update]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(!commandOpen);
        return;
      }
      if (typing || commandOpen || !event.altKey) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < TIME_RANGES.length) {
        event.preventDefault();
        update({ range: TIME_RANGES[index] });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen, update]);

  useEffect(() => {
    if (!live || !token) return;
    let stopped = false;
    let disconnect: (() => void) | undefined;
    void probeApi().then((up) => {
      if (stopped || !up) return;
      disconnect = connectLive({
        projectId: scope.project,
        token,
        onStatus: setConnected,
        onSnapshot: () => {
          void client.invalidateQueries({ queryKey: ["overview"] });
          void client.invalidateQueries({ queryKey: ["incidents"] });
        },
      });
    });
    return () => {
      stopped = true;
      disconnect?.();
    };
  }, [client, live, scope.project, token]);

  return (
    <>
      <div className="aurora" aria-hidden />
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-elevated focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="relative z-10 flex min-h-screen" data-density={density}>
        <aside className="sticky top-0 hidden h-screen shrink-0 lg:block">
          <Sidebar alertCount={firing} />
        </aside>
        <div className="min-w-0 flex-1">
          <TopBar connected={connected} onMenu={() => setMenu(true)} />
          <main id="content" className="page-main px-3 py-5 sm:px-5 lg:px-6">
            <Suspense fallback={<PageSkeleton />}>
              <motion.div
                key={location.pathname}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
              >
                <Outlet />
              </motion.div>
            </Suspense>
          </main>
        </div>
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Primary navigation</SheetDescription>
          <Sidebar alertCount={firing} onNavigate={() => setMenu(false)} />
        </SheetContent>
      </Sheet>
      <CommandPalette />
    </>
  );
}
