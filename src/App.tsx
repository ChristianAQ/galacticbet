import BottomNavigation from "./components/BottomNavigation";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  ChevronRight,
  Home,
  Menu,
  ShieldCheck,
  Target,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Link,
  Route,
  Routes,
  useNavigate,
  useLocation,
} from "react-router-dom";
import LoginModal from "./components/LoginModal";
import Sidebar from "./components/Sidebar";
import { Empty, PrivateGate, readableError } from "./components/ui";
import {
  loadGroups,
  loadMatches,
  ensureGroupCompetitions,
  type Group,
} from "./lib/data";
import { demoMatches } from "./lib/demo";
import { type Match } from "./lib/domain";
import { MOBILE_LAYOUT_QUERY } from "./lib/mobileViewport";
import { auth, configured, db } from "./lib/firebase";
import { privateCache } from "./lib/memoryCache";
import { applyLiveBoard } from "./lib/liveBoard";
import { LiveContext, useLiveBoard } from "./lib/useLiveBoard";
const pageLoaders = {
  "/equipos": () => import("./pages/TeamsPage"),
  "/": () => import("./pages/HomePage"),
  "/partidos": () => import("./pages/MatchesPage"),
  "/quiniela": () => import("./pages/PredictionsPage"),
  "/grupos": () => import("./pages/GroupsPage"),
  "/clasificacion": () => import("./pages/StandingsPage"),
  "/perfil": () => import("./pages/ProfilePage"),
  "/porra": () => import("./pages/PorraPage"),
};
const TeamsPage = lazy(pageLoaders["/equipos"]);
const HomePage = lazy(pageLoaders["/"]);
const MatchesPage = lazy(pageLoaders["/partidos"]);
const PredictionsPage = lazy(pageLoaders["/quiniela"]);
const GroupsPage = lazy(pageLoaders["/grupos"]);
const StandingsPage = lazy(pageLoaders["/clasificacion"]);
const ProfilePage = lazy(pageLoaders["/perfil"]);
const PorraPage = lazy(pageLoaders["/porra"]);
function preloadPage(path: string) {
  const load = pageLoaders[path as keyof typeof pageLoaders];
  if (load) void load().catch(() => {});
}
const nav = [
  { to: "/", label: "Inicio", icon: Home },
  { to: "/partidos", label: "Partidos", icon: CalendarDays },
  { to: "/quiniela", label: "Mi quiniela", short: "Quiniela", icon: Target },
  { to: "/clasificacion", label: "Clasificación", icon: Trophy },
  { to: "/grupos", label: "Mis grupos", short: "Grupos", icon: Users },
];
export default function App() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.body.style.position !== "fixed")
        window.scrollTo({ top: 0, behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
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
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(
    () => window.matchMedia(MOBILE_LAYOUT_QUERY).matches,
  );
  const closeMenu = useCallback(() => setMenu(false), []);
  const mobileMenuOpen = mobile && menu;
  useEffect(() => {
    const query = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setMenu(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
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
  return (
    <LiveContext.Provider value={live}>
      <div className="app-shell">
        <Sidebar
          open={mobileMenuOpen}
          mobile={mobile}
          onClose={closeMenu}
          items={nav}
          onPrefetch={preloadPage}
        />
        <div
          className="main-shell"
          inert={mobileMenuOpen}
          aria-hidden={mobileMenuOpen || undefined}
        >
          <header className="topbar">
            <button
              className="mobile-menu icon-button"
              aria-label={mobileMenuOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileMenuOpen}
              aria-controls="app-sidebar"
              onClick={() => setMenu((value) => !value)}
            >
              <Menu />
            </button>
            <div className="topbar-breadcrumb">
              Tu comunidad. Tu fútbol.<span>/</span>
              <strong>Temporada 2026 / 27</strong>
            </div>
            <div className="topbar-right">
              <span className="private-label">
                <ShieldCheck size={15} /> Ligas privadas, rivalidad real
              </span>
              <button
                aria-label="Ver perfil"
                onPointerEnter={() => preloadPage("/perfil")}
                onFocus={() => preloadPage("/perfil")}
                onPointerDown={() => preloadPage("/perfil")}
                className="profile-button"
                onClick={() => navigate("/perfil")}
              >
                <span className="avatar">
                  {user?.photoURL ? (
                    <img src={user.photoURL} alt="Tu avatar" />
                  ) : (
                    user?.displayName?.charAt(0) || "G"
                  )}
                </span>
                <span>{user?.displayName || "Mi perfil"}</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </header>
          <main>
            {demo && (
              <div className="demo-banner">
                <span>
                  <Activity size={15} /> Modo demo · Calendario y resultados de
                  ejemplo. Los pronósticos no se guardan en la nube.
                </span>
                <button onClick={() => setDemo(false)}>
                  Salir de demo <X size={14} />
                </button>
              </div>
            )}
            {error && (
              <div className="error" role="alert">
                {error}
                <button onClick={() => setError("")} aria-label="Cerrar error">
                  <X size={16} />
                </button>
              </div>
            )}
            <Suspense
              fallback={
                <div
                  className="page-skeleton"
                  role="status"
                  aria-label="Cargando página"
                >
                  <span />
                  <span />
                  <span />
                </div>
              }
            >
              <div className="route-view" key={pathname}>
                <Routes>
                  <Route
                    path="/equipos"
                    element={<TeamsPage matches={matches} demo={demo} />}
                  />
                  <Route
                    path="/"
                    element={
                      <HomePage
                        userId={user?.uid || ""}
                        matches={matches}
                        loading={loading}
                        demo={demo}
                      />
                    }
                  />
                  <Route
                    path="/partidos"
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
                        <Empty title="Comprobando sesión…">Un momento.</Empty>
                      ) : !user && !demo ? (
                        <PrivateGate
                          onLogin={() => setLogin(true)}
                          onDemo={() => setDemo(true)}
                        />
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
                        <Empty title="Preparando tus porras…">
                          Un momento.
                        </Empty>
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
                      <Empty title="Fuera de juego">
                        Esta página no existe.{" "}
                        <Link to="/">Volver al inicio</Link>
                      </Empty>
                    }
                  />
                </Routes>
              </div>
            </Suspense>
            <footer className="main-footer">
              <span>© {new Date().getFullYear()} GalacticBet</span>
              <span>
                Fútbol real. Rivalidad sana.{" "}
                <span className="green-text">Siempre entre amigos.</span>
              </span>
              <Link to="/perfil?tab=play">
                Cómo jugar <ArrowUpRight size={13} />
              </Link>
            </footer>
          </main>
        </div>
        <BottomNavigation
          items={nav}
          inactive={mobileMenuOpen}
          onPrefetch={preloadPage}
        />
        {login && <LoginModal close={() => setLogin(false)} />}
      </div>
    </LiveContext.Provider>
  );
}
