import BottomNavigation from "./components/BottomNavigation";
import { onAuthStateChanged } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { CalendarDays, Home, Target, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, type Location } from "react-router-dom";
import LoginModal from "./components/LoginModal";
import Sidebar from "./components/Sidebar";
import NavBar from "./components/NavBar";
import StackNavigator from "./components/StackNavigator";
import PullToRefresh from "./components/PullToRefresh";
import ContextMenuHost from "./components/ContextMenu";
import { Empty, PageTitle, readableError } from "./components/ui";
import {
  loadGroups,
  loadMatches,
  ensureGroupCompetitions,
  storedGroups,
  type Group,
} from "./lib/data";
import { readSession, rememberSession, type AppUser } from "./lib/session";
import { useUpdateReady } from "./lib/appUpdate";
import { demoMatches } from "./lib/demo";
import { type Match } from "./lib/domain";
import { auth, configured, db } from "./lib/firebase";
import { privateCache } from "./lib/memoryCache";
import { applyLiveBoard } from "./lib/liveBoard";
import { LiveContext, STANDINGS_UPDATED, useLiveBoard } from "./lib/useLiveBoard";
import { REFRESH_EVENT, RefreshContext } from "./lib/chrome";
import { go, interceptLinks, isTabRoot } from "./lib/navigation";
import { keepPushDevice } from "./lib/push";
import {
  CompetitionCreatePage,
  CustomMatchPage,
  GroupsPage,
  HomePage,
  MatchesPage,
  MatchPage,
  PorraPage,
  preloadPage,
  preloadTabsWhenIdle,
  ProfilePage,
  QuinielaPage,
  TeamsPage,
} from "./lib/pages";

const nav = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/ligas", label: "Ligas", icon: CalendarDays },
  { to: "/quiniela", label: "Quiniela", icon: Target },
];
const storedCalendar = () => (configured ? loadMatches.peek() ?? [] : []);

/** The old Clasificación tab lives in Quiniela now (avisos and links still land there). */
function LegacyStandingsRoute() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  params.set("vista", "clasificacion");
  return <Navigate to={{ pathname: "/quiniela", search: `?${params}`, hash }} replace />;
}

function LegacyMatchesRoute() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/ligas", search, hash }} replace />;
}

export default function App() {
  const { pathname } = useLocation();
  const [, setProfileVersion] = useState(0);
  // The account of the last launch paints at once; Firebase confirms it (or
  // signs out) after its own network round trips.
  const [user, setUser] = useState<AppUser | null>(() =>
    auth ? readSession() : null,
  );
  const [authReady, setAuthReady] = useState(() => !auth || Boolean(user));
  const [demo, setDemo] = useState(false);
  // Last calendar on this device, even if a few days old: the first paint has
  // fixtures and the network only swaps in fresher scores.
  const [calendar, setMatches] = useState<Match[]>(storedCalendar);
  const live = useLiveBoard(calendar, configured && !demo);
  // Faster live scores over the cached calendar; official results always win.
  const matches = useMemo(
    () => applyLiveBoard(calendar, live.board),
    [calendar, live.board],
  );
  const [groups, setGroups] = useState<Group[]>(
    () => (user && storedGroups(user.uid)) || [],
  );
  const [groupsUid, setGroupsUid] = useState(() =>
    user && storedGroups(user.uid) ? user.uid : "",
  );
  const activeGroups = user && groupsUid === user.uid ? groups : [];
  // Until then «no groups» only means «not loaded yet».
  const groupsReady = Boolean(user) && groupsUid === user?.uid;
  const [loading, setLoading] = useState(
    () => configured && calendar.length === 0,
  );
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  const updateReady = useUpdateReady();
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => interceptLinks(), []);
  // A tapped aviso while the app is open: go to the screen it is about.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const open = (event: MessageEvent) => {
      const hash = event.data?.type === "galacticbet:open" ? event.data.hash : "";
      if (typeof hash === "string" && hash.startsWith("#/")) go(hash.slice(1), { reset: true });
    };
    navigator.serviceWorker.addEventListener("message", open);
    return () => navigator.serviceWorker.removeEventListener("message", open);
  }, []);
  useEffect(() => preloadTabsWhenIdle(), []);
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(auth, (u) => {
            const previous = readSession();
            // Same account as the remembered one: keep what already loaded.
            if (previous?.uid !== u?.uid) privateCache.clear();
            rememberSession(u);
            if (u) void keepPushDevice(u.uid);
            setUser(u);
            if (u) setLogin(false);
            setAuthReady(true);
            const known =
              previous?.uid === u?.uid &&
              previous?.displayName === u?.displayName &&
              previous?.photoURL === u?.photoURL;
            // The public profile only needs writing when it changed.
            if (u && db && !known)
              void setDoc(
                doc(db, "users", u.uid),
                {
                  name: u.displayName || "Jugador",
                  avatar: u.photoURL || null,
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              ).catch((e) =>
                setError(
                  "Se inició sesión, pero no se pudo guardar el perfil: " +
                    readableError(e),
                ),
              );
          })
        : undefined,
    [],
  );
  /** `quiet`: stored groups are on screen, so being offline is not news. */
  async function refreshGroups(quiet = false) {
    const report = (e: unknown, prefix = "") => {
      if (auth?.currentUser?.uid !== user?.uid) return;
      const code = (e as { code?: string })?.code;
      if (quiet && (!navigator.onLine || code === "unavailable" || code === "offline"))
        return;
      setError(prefix + readableError(e));
    };
    if (user) {
      try {
        const next = await loadGroups(user.uid);
        // Show the groups first; preparing a new season is the owner's
        // background chore (and usually there is nothing to prepare).
        if (auth?.currentUser?.uid === user.uid) {
          setGroups(next);
          setGroupsUid(user.uid);
        }
        const setup = await Promise.allSettled(
          next
            .filter((g) => g.ownerId === user.uid)
            .map((g) => ensureGroupCompetitions(user.uid, g.id)),
        );
        const failed = setup.find((r) => r.status === "rejected");
        if (failed?.status === "rejected")
          report(failed.reason, "No se pudieron preparar las tres competiciones: ");
      } catch (e) {
        // (A remembered session that Firebase did not confirm is not an error.)
        report(e);
      }
    }
  }
  useEffect(() => {
    const stored = storedCalendar();
    setMatches(demo ? demoMatches : stored);
    if (demo || !configured) {
      setLoading(false);
      return;
    }
    let active = true;
    let shown = stored.length > 0;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      loadMatches()
        .then((next) => {
          shown = true;
          if (active) setMatches(next);
        })
        .catch((e) => {
          // With a stored calendar on screen a failed refresh is not news.
          if (active && !shown) setError(readableError(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    setLoading(!shown);
    refresh();
    // The shared loader deduplicates requests and checks at most once every five minutes.
    const interval = window.setInterval(refresh, 5 * 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [demo]);
  // Keyed by account, not by object: confirming the remembered session must
  // not blank the groups already on screen.
  useEffect(() => {
    void refreshGroups(groupsUid === user?.uid);
  }, [user?.uid]);
  /**
   * Pull to refresh: calendar at most a minute old, groups and rankings again.
   * Quotas stay safe because the loader still deduplicates and caches.
   */
  const refreshAll = useCallback(async () => {
    window.dispatchEvent(new Event(REFRESH_EVENT));
    if (demo || !configured) return;
    window.dispatchEvent(new Event(STANDINGS_UPDATED));
    await Promise.allSettled([
      loadMatches({ maxAge: 60_000 }).then(setMatches, (e) =>
        setError(readableError(e)),
      ),
      refreshGroups(),
    ]);
  }, [demo, user]);

  const renderRoutes = (location: Location) => (
    <Routes location={location}>
      <Route path="/partidos" element={<LegacyMatchesRoute />} />
      <Route path="/equipos" element={<TeamsPage matches={matches} demo={demo} />} />
      <Route
        path="/"
        element={
          <HomePage
            userId={user?.uid || ""}
            user={user}
            groups={activeGroups}
            matches={matches}
            loading={loading}
            demo={demo}
            onLogin={() => setLogin(true)}
          />
        }
      />
      <Route
        path="/partido/:id"
        element={
          <MatchPage
            matches={matches}
            loading={loading}
            demo={demo}
            userId={user?.uid || ""}
          />
        }
      />
      <Route
        path="/competicion/:cid/partido/:mid"
        element={<CustomMatchPage user={user} onLogin={() => setLogin(true)} />}
      />
      <Route
        path="/ligas"
        element={
          <MatchesPage
            matches={matches}
            demo={demo}
            onDemo={() => setDemo(true)}
            loading={loading}
            userId={user?.uid || ""}
            user={user}
            onLogin={() => setLogin(true)}
          />
        }
      />
      <Route
        path="/quiniela"
        element={
          !authReady ? (
            <PageTitle title="Quiniela" eyebrow="Comprobando tu ficha…" />
          ) : (
            <QuinielaPage
              matches={matches}
              groups={activeGroups}
              groupsReady={groupsReady}
              user={user}
              demo={demo}
              loading={loading}
              onLogin={() => setLogin(true)}
              onDemo={() => setDemo(true)}
            />
          )
        }
      />
      <Route
        path="/grupos"
        element={
          <GroupsPage
            user={user}
            groups={activeGroups}
            refresh={() => refreshGroups()}
            onLogin={() => setLogin(true)}
          />
        }
      />
      <Route path="/clasificacion" element={<LegacyStandingsRoute />} />
      <Route
        path="/perfil"
        element={
          <ProfilePage
            user={user}
            groups={activeGroups}
            onLogin={() => setLogin(true)}
            onUpdated={() => {
              if (auth?.currentUser) rememberSession(auth.currentUser);
              setProfileVersion((v) => v + 1);
            }}
          />
        }
      />
      <Route
        path="/competiciones/nueva"
        element={
          <CompetitionCreatePage
            user={user}
            groups={activeGroups}
            onLogin={() => setLogin(true)}
          />
        }
      />
      <Route
        path="/porra"
        element={
          !authReady ? (
            <PageTitle title="Porra rápida" eyebrow="Preparando tus porras…" />
          ) : (
            <PorraPage
              key={user?.uid || "guest"}
              owner={user?.uid || "guest"}
              matches={matches}
              demo={demo}
              loading={loading}
            />
          )
        }
      />
      <Route
        path="*"
        element={
          <>
            <PageTitle title="Fuera de juego" eyebrow="Error 404" />
            <Empty
              art="flag"
              title="El linier ha levantado la bandera"
              action={
                <a className="button primary" href="#/" data-nav="tab">
                  Volver al inicio
                </a>
              }
            >
              Esta página no existe o se quedó en el vestuario.
            </Empty>
          </>
        }
      />
    </Routes>
  );

  return (
    <LiveContext.Provider value={live}>
      <RefreshContext.Provider value={refreshAll}>
        <div className="app-shell">
          <Sidebar items={nav} onPrefetch={preloadPage} />
          <div className="main-shell">
            <NavBar user={user} />
            <main className="main">
              <StackNavigator render={renderRoutes} />
            </main>
            <footer className="main-footer">
              <span>© {new Date().getFullYear()} GalacticBet</span>
              <span>Fútbol real. Rivalidad sana. Siempre entre amigos.</span>
            </footer>
          </div>
          <PullToRefresh enabled={isTabRoot(pathname)} onRefresh={refreshAll} />
          {/* The tab bar lives on the four tab roots only. Pushed screens (match
              page, Equipos, Porra, Perfil, Grupos) get the whole height and go
              back with «‹» or the edge swipe. */}
          <BottomNavigation
            items={nav}
            inactive={!isTabRoot(pathname)}
            onPrefetch={preloadPage}
          />
          {demo && (
            <div className="demo-pill" role="status">
              <span>Modo demo</span>
              <button type="button" onClick={() => setDemo(false)}>
                Salir
              </button>
            </div>
          )}
          {error ? (
            <div className="toast is-error" role="alert">
              <p>{error}</p>
              <button onClick={() => setError("")} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          ) : (
            updateReady &&
            !updateDismissed && (
              <div className="toast is-update" role="status">
                <p>Hay una versión nueva de GalacticBet.</p>
                <button
                  type="button"
                  className="toast-action"
                  onClick={() => window.location.reload()}
                >
                  Actualizar
                </button>
                <button
                  type="button"
                  onClick={() => setUpdateDismissed(true)}
                  aria-label="Más tarde"
                >
                  <X size={16} />
                </button>
              </div>
            )
          )}
          <ContextMenuHost />
          {login && <LoginModal close={() => setLogin(false)} />}
        </div>
      </RefreshContext.Provider>
    </LiveContext.Provider>
  );
}
