import { Suspense, useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Outlet, useLocation, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CommandPalette } from "@/components/layout/command-palette";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { PageSkeleton } from "@/components/shared/states";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIncidentsQuery, useProjectsQuery } from "@/hooks/queries";
import { useScope } from "@/hooks/use-scope";
import { FirstProject } from "@/features/onboarding/first-project";
import { api, probeApi } from "@/lib/api/client";
import { TIME_RANGES } from "@/lib/api/types";
import { connectLive } from "@/lib/ws";
import { useSession } from "@/store/session";
import { useUi } from "@/store/ui";

// Pages that make sense without a project.
const ACCOUNT_PAGES = ["/profile", "/users"];

export function AppShell() {
  const [params] = useSearchParams();
  const scope = useScope();
  const update = scope.update;
  const [menu, setMenu] = useState(false);
  const [connected, setConnected] = useState(false);
  const token = useSession((state) => state.token);
  const setSession = useSession((state) => state.setSession);
  const live = useUi((state) => state.live);
  const density = useUi((state) => state.density);
  const setCommandOpen = useUi((state) => state.setCommandOpen);
  const commandOpen = useUi((state) => state.commandOpen);
  const client = useQueryClient();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const incidents = useIncidentsQuery();
  const projects = useProjectsQuery();
  const firing = (incidents.data ?? []).filter(
    (incident) => incident.status === "firing",
  ).length;

  useEffect(() => {
    if (!params.get("range") || !params.get("project") || !params.get("env"))
      update({});
  }, [params, update]);

  useEffect(() => {
    const list = projects.data;
    if (
      !projects.isSuccess ||
      !list?.length ||
      list.some((item) => item.slug === scope.project)
    )
      return;
    update({ project: list[0].slug });
  }, [projects.data, projects.isSuccess, scope.project, update]);

  // The saved role can be stale: sessions saved before roles existed have none, and an admin may have
  // changed it since. Ask the API once per page load.
  useEffect(() => {
    if (!token || token === "demo.pulseops.token") return;
    let cancelled = false;
    void api
      .me()
      .then((user) => {
        if (cancelled || !user) return;
        const current = useSession.getState();
        if (current.role !== user.role || current.name !== user.name)
          setSession({ ...user, token });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [token, setSession]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
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

  const noProjects =
    projects.isSuccess &&
    projects.data.length === 0 &&
    token !== "demo.pulseops.token";
  // The saved project is not one of this account's projects. Hold the page until the switch above lands.
  const switching =
    projects.isSuccess &&
    projects.data.length > 0 &&
    !projects.data.some((item) => item.slug === scope.project);

  return (
    <>
      <div className="aurora" aria-hidden />
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-elevated focus:px-3 focus:py-2"
      >
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
                {noProjects &&
                !ACCOUNT_PAGES.some((path) =>
                  location.pathname.startsWith(path),
                ) ? (
                  <FirstProject />
                ) : switching ? (
                  <PageSkeleton />
                ) : (
                  <Outlet />
                )}
              </motion.div>
            </Suspense>
          </main>
        </div>
      </div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-72 p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Primary navigation
          </SheetDescription>
          <Sidebar alertCount={firing} onNavigate={() => setMenu(false)} />
        </SheetContent>
      </Sheet>
      <CommandPalette />
    </>
  );
}
