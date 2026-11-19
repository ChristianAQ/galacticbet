import BottomNavigation from "./components/BottomNavigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { CalendarDays, Home, Target, Trophy, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, type Location } from "react-router-dom";
import LoginModal from "./components/LoginModal";
import Sidebar from "./components/Sidebar";
import NavBar from "./components/NavBar";
import StackNavigator from "./components/StackNavigator";
import PullToRefresh from "./components/PullToRefresh";
import ContextMenuHost from "./components/ContextMenu";
import { Empty, PageTitle, PrivateGate, readableError } from "./components/ui";
import {
  loadGroups,
  loadMatches,
  ensureGroupCompetitions,
  type Group,
} from "./lib/data";
import { demoMatches } from "./lib/demo";
import { type Match } from "./lib/domain";
import { auth, configured, db } from "./lib/firebase";
import { privateCache } from "./lib/memoryCache";
import { applyLiveBoard } from "./lib/liveBoard";
import { LiveContext, STANDINGS_UPDATED, useLiveBoard } from "./lib/useLiveBoard";
import { REFRESH_EVENT, RefreshContext } from "./lib/chrome";
import { interceptLinks, isTabRoot } from "./lib/navigation";
import {
  GroupsPage,
  HomePage,
  MatchesPage,
  MatchPage,
  PorraPage,
  PredictionsPage,
  preloadPage,
  preloadTabsWhenIdle,
  ProfilePage,
  StandingsPage,
  TeamsPage,
} from "./lib/pages";

const nav = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/ligas", label: "Ligas", icon: CalendarDays },
  { to: "/quiniela", label: "Mi quiniela", short: "Quiniela", icon: Target },
  { to: "/clasificacion", label: "Clasificación", icon: Trophy },
];
function LegacyMatchesRoute() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/ligas", search, hash }} replace />;
}

export default function App() {
  const { pathname } = useLocation();
  const [, setProfileVersion] = useState(0);
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!auth);
  const [demo, setDemo] = useState(false);
  const [calendar, setMatches] = useState<Match[]>([]);
  const live = useLiveBoard(calendar, configured && !demo);
  // Faster live scores over the cached calendar; official results always win.
  const matches = useMemo(
    () => applyLiveBoard(calendar, live.board),
    [calendar, live.board],
  );
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsUid, setGroupsUid] = useState("");
  const activeGroups = user && groupsUid === user.uid ? groups : [];
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [login, setLogin] = useState(false);
  useEffect(() => interceptLinks(), []);
  useEffect(() => preloadTabsWhenIdle(), []);
  useEffect(
    () =>
      auth
        ? onAuthStateChanged(auth, (u) => {
            privateCache.clear();
            setUser(u);
            if (u) setLogin(false);
            setAuthReady(true);
            if (u && db)
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
  async function refreshGroups() {
    if (user) {
      try {
        const next = await loadGroups(user.uid);
        const setup = await Promise.allSettled(
          next
            .filter((g) => g.ownerId === user.uid)
            .map((g) => ensureGroupCompetitions(user.uid, g.id)),
        );
        const failed = setup.find((r) => r.status === "rejected");
        if (
          failed?.status === "rejected" &&
          auth?.currentUser?.uid === user.uid
        )
          setError(
            "No se pudieron preparar las tres competiciones: " +
              readableError(failed.reason),
          );
        if (auth?.currentUser?.uid === user.uid) {
          setGroups(next);
          setGroupsUid(user.uid);
        }
      } catch (e) {
        setError(readableError(e));
      }
    }
  }
  useEffect(() => {
    setMatches(demo ? demoMatches : []);
    if (demo || !configured) {
      setLoading(false);
      return;
    }
    let active = true;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      loadMatches()
        .then((next) => {
          if (active) setMatches(next);
        })
        .catch((e) => {
          if (active) setError(readableError(e));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    setLoading(true);
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
  useEffect(() => {
    setGroups([]);
    void refreshGroups();
  }, [user]);
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
        path="/ligas"
        element={
          <MatchesPage
            matches={matches}
            demo={demo}
            onDemo={() => setDemo(true)}
            loading={loading}
            userId={user?.uid || ""}
          />
        }
      />
      <Route
        path="/quiniela"
        element={
          !authReady ? (
            <PageTitle title="Mi quiniela" eyebrow="Comprobando tu ficha…" />
          ) : !user && !demo ? (
            <>
              <PageTitle title="Mi quiniela" eyebrow="Quiniela" />
              <PrivateGate
                onLogin={() => setLogin(true)}
                onDemo={() => setDemo(true)}
              />
            </>
          ) : (
            <PredictionsPage
              matches={matches}
              groups={activeGroups}
              user={user}
              demo={demo}
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
            refresh={refreshGroups}
            onLogin={() => setLogin(true)}
          />
        }
      />
      <Route
        path="/clasificacion"
        element={
          <StandingsPage
            groups={activeGroups}
            matches={matches}
            loading={loading}
            user={user}
            onLogin={() => setLogin(true)}
          />
        }
      />
      <Route
        path="/perfil"
        element={
          <ProfilePage
            user={user}
            groups={activeGroups}
            onLogin={() => setLogin(true)}
            onUpdated={() => setProfileVersion((v) => v + 1)}
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
          {error && (
            <div className="toast is-error" role="alert">
              <p>{error}</p>
              <button onClick={() => setError("")} aria-label="Cerrar aviso">
                <X size={16} />
              </button>
            </div>
          )}
          <ContextMenuHost />
          {login && <LoginModal close={() => setLogin(false)} />}
        </div>
      </RefreshContext.Provider>
    </LiveContext.Provider>
  );
}
