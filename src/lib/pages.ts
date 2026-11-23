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
  "/competicion": () => import("../pages/CustomMatchPage"),
  "/competiciones/nueva": () => import("../pages/CompetitionCreatePage"),
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
export const CustomMatchPage = lazy(pageLoaders["/competicion"]);
export const CompetitionCreatePage = lazy(pageLoaders["/competiciones/nueva"]);

const loaded = new Map<string, Promise<unknown>>();
/** Starts (once) the download of a page chunk and resolves when it is ready. */
export function preloadPage(path: string): Promise<unknown> {
  const pathname = path.split(/[?#]/)[0];
  const base = pathname.startsWith("/partido")
    ? "/partido"
    : pathname.startsWith("/competicion/")
      ? "/competicion"
      : pathname;
  const load = pageLoaders[base as PagePath];
  if (!load) return Promise.resolve();
  let pending = loaded.get(base);
  if (!pending) {
    pending = load().catch(() => loaded.delete(base));
    loaded.set(base, pending);
  }
  return pending;
}
/**
 * Pages are warmed when the browser is idle: tab roots and the match page
 * first, then the rest. Every screen of this version ends up in the service
 * worker's cache, so opening one never waits for (or fails on) the network.
 */
export function preloadTabsWhenIdle() {
  const idle =
    window.requestIdleCallback ||
    ((callback: () => void) => window.setTimeout(callback, 1200));
  idle(() => {
    const first = ["/", "/ligas", "/quiniela", "/clasificacion", "/partido"];
    void Promise.allSettled(first.map(preloadPage)).then(() =>
      idle(() => {
        for (const path of Object.keys(pageLoaders)) void preloadPage(path);
      }),
    );
  });
}
