import { lazy } from "react";

/** Route chunks, so navigation can warm a page up before it is shown. */
export const pageLoaders = {
  "/": () => import("../pages/HomePage"),
  "/ligas": () => import("../pages/MatchesPage"),
  "/quiniela": () => import("../pages/PredictionsPage"),
  "/clasificacion": () => import("../pages/StandingsPage"),
  "/perfil": () => import("../pages/ProfilePage"),
  "/grupos": () => import("../pages/GroupsPage"),
  "/porra": () => import("../pages/PorraPage"),
  "/equipos": () => import("../pages/TeamsPage"),
  "/partido": () => import("../pages/MatchPage"),
};
type PagePath = keyof typeof pageLoaders;

export const HomePage = lazy(pageLoaders["/"]);
export const MatchesPage = lazy(pageLoaders["/ligas"]);
export const PredictionsPage = lazy(pageLoaders["/quiniela"]);
export const StandingsPage = lazy(pageLoaders["/clasificacion"]);
export const ProfilePage = lazy(pageLoaders["/perfil"]);
export const GroupsPage = lazy(pageLoaders["/grupos"]);
export const PorraPage = lazy(pageLoaders["/porra"]);
export const TeamsPage = lazy(pageLoaders["/equipos"]);
export const MatchPage = lazy(pageLoaders["/partido"]);

const loaded = new Map<string, Promise<unknown>>();
/** Starts (once) the download of a page chunk and resolves when it is ready. */
export function preloadPage(path: string): Promise<unknown> {
  const pathname = path.split(/[?#]/)[0];
  const base = pathname.startsWith("/partido") ? "/partido" : pathname;
  const load = pageLoaders[base as PagePath];
  if (!load) return Promise.resolve();
  let pending = loaded.get(base);
  if (!pending) {
    pending = load().catch(() => loaded.delete(base));
    loaded.set(base, pending);
  }
  return pending;
}
/** Tab roots are warmed when the browser is idle so the first switch is instant. */
export function preloadTabsWhenIdle() {
  const idle =
    window.requestIdleCallback ||
    ((callback: () => void) => window.setTimeout(callback, 1200));
  idle(() => {
    for (const path of ["/", "/ligas", "/quiniela", "/clasificacion", "/partido"])
      void preloadPage(path);
  });
}
