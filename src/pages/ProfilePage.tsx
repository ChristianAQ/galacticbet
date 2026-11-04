import type { User } from "firebase/auth";
import { ArrowRight, LogOut, Target, Trophy, UserRound } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import GroupList from "../components/GroupList";
import { FormGuide } from "../components/TeamForm";
import { Empty, PageTitle, readableError } from "../components/ui";
import type { Group } from "../lib/data";
import { logout, saveDisplayName } from "../lib/firebase";

const tabs = [
  { id: "profile", label: "Mi perfil" },
  { id: "groups", label: "Mis grupos" },
  { id: "play", label: "Cómo jugar" },
];
export default function ProfilePage({
  user,
  groups,
  onLogin,
  onUpdated,
}: {
  user: User | null;
  groups: Group[];
  onLogin: () => void;
  onUpdated: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((t) => t.id === params.get("tab"))
    ? params.get("tab")!
    : user
      ? "profile"
      : "play";
  const [name, setName] = useState(user?.displayName || "");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    setName(user?.displayName || "");
  }, [user?.uid, user?.displayName]);
  useEffect(() => {
    setMessage("");
    setError("");
  }, [user?.uid]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await saveDisplayName(name);
      onUpdated();
      setMessage("Nombre actualizado. Tus amigos te verán con este nombre.");
    } catch (e) {
      onUpdated();
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setSigningOut(true);
    setLogoutError("");
    try {
      await logout();
    } catch (e) {
      setLogoutError(readableError(e));
    } finally {
      setSigningOut(false);
    }
  }
  function select(id: string) {
    setParams({ tab: id }, { replace: true });
  }
  return (
    <>
      <PageTitle
        eyebrow="TU RINCÓN DEL VESTUARIO"
        title="Mi perfil"
        description="Tu nombre, tus grupos y todo lo que necesitas para jugar."
      />
      <div
        className="tabs profile-tabs"
        role="tablist"
        aria-label="Secciones de perfil"
      >
        {tabs.map((t, index) => (
          <button
            key={t.id}
            id={`profile-tab-${t.id}`}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`profile-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? "selected" : ""}
            onClick={() => select(t.id)}
            onKeyDown={(e) => {
              let next = index;
              if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (e.key === "ArrowLeft")
                next = (index + tabs.length - 1) % tabs.length;
              else if (e.key === "Home") next = 0;
              else if (e.key === "End") next = tabs.length - 1;
              else return;
              e.preventDefault();
              select(tabs[next].id);
              document.getElementById(`profile-tab-${tabs[next].id}`)?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section
        role="tabpanel"
        id={`profile-panel-${tab}`}
        aria-labelledby={`profile-tab-${tab}`}
        tabIndex={0}
      >
        {tab === "profile" ? (
          user ? (
            <div className="panel profile-editor">
              <div className="profile-identity">
                <span className="profile-large-avatar">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt="Tu avatar" />
                  ) : (
                    <UserRound size={32} />
                  )}
                </span>
                <div>
                  <h2>{user.displayName || "Jugador"}</h2>
                  <p>{user.email}</p>
                </div>
              </div>
              <form onSubmit={save}>
                <label>
                  Nombre visible
                  <input
                    autoComplete="nickname"
                    required
                    maxLength={100}
                    value={name}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <p className="muted">
                  Así aparecerás en tus grupos, pronósticos y clasificaciones.
                </p>
                <button
                  className="button primary"
                  disabled={busy || !name.trim()}
                >
                  {busy ? "Guardando…" : "Guardar nombre"}
                </button>
              </form>
              {message && (
                <p className="form-message" role="status">
                  {message}
                </p>
              )}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
          ) : (
            <div className="panel">
              <Empty title="Tu perfil te espera">
                Inicia sesión para editar tu nombre y consultar tus grupos.
                <br />
                <button className="button primary" onClick={onLogin}>
                  Iniciar sesión
                </button>
              </Empty>
            </div>
          )
        ) : tab === "groups" ? (
          user ? (
            <>
              {groups.length ? (
                <GroupList groups={groups} uid={user.uid} />
              ) : (
                <div className="panel">
                  <Empty title="Todavía no tienes grupo">
                    Crea uno o únete al de tus amigos desde Mis grupos.
                  </Empty>
                </div>
              )}
              <Link
                className="button secondary profile-groups-link"
                to="/grupos"
              >
                Ir a Mis grupos
                <ArrowRight size={16} />
              </Link>
            </>
          ) : (
            <div className="panel">
              <Empty title="El fútbol se comparte">
                Inicia sesión para ver los grupos a los que perteneces.
                <br />
                <button className="button primary" onClick={onLogin}>
                  Iniciar sesión
                </button>
              </Empty>
            </div>
          )
        ) : (
          <>
            <div className="rules-grid">
              <div className="panel form-panel">
                <Target className="green-text" />
                <h2>Quiniela clásica</h2>
                <p>
                  1 si gana el local, X para el empate y 2 si gana el visitante.
                </p>
                <h3>1 punto por acierto</h3>
                <p>Un fallo suma 0 puntos.</p>
              </div>
              <div className="panel form-panel">
                <Trophy className="green-text" />
                <h2>Marcador exacto</h2>
                <p>
                  Pronostica los goles de cada equipo durante el tiempo
                  reglamentario.
                </p>
                <h3>3 puntos por marcador exacto</h3>
                <p>
                  1 punto por ganador o empate. No se acumulan: el máximo es 3.
                </p>
              </div>
            </div>
            <div className="panel form-panel">
              <h2>Así se juega</h2>
              <ol className="how-to-steps">
                <li>
                  Crea un grupo o únete con el código de tus amigos. Los grupos
                  nuevos incluyen LaLiga, Champions y Premier League.
                </li>
                <li>
                  En Mi quiniela, elige tu grupo y pulsa el logo de la
                  competición. Selecciona la jornada y completa tus pronósticos.
                </li>
                <li>
                  Tus elecciones se conservan al aplicarlas. Puedes revisarlas
                  hasta el inicio del primer partido de la jornada o hasta
                  pulsar Guardar quiniela y confirmar el cierre definitivo de
                  toda la jornada.
                </li>
                <li>
                  Al guardar, la jornada pasa a El grupo y ya estás jugando. Tus
                  pronósticos siguen visibles. Solo los miembros que hayan
                  completado y guardado la jornada podrán compartir sus
                  elecciones entre sí, también antes del inicio.
                </li>
                <li>
                  Consulta los puntos de una jornada o el acumulado en
                  Clasificación.
                </li>
              </ol>
              <p>La modalidad queda fija durante la temporada.</p>
              <p>
                Sin dinero de por medio. Solo intuición, fútbol y rivalidad
                entre amigos.
              </p>
              {!user && (
                <button className="button primary" onClick={onLogin}>
                  Empezar a jugar
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
            <div className="panel form-panel match-help-panel">
              <h2>Forma y datos de los partidos</h2>
              <FormGuide />
              <p>
                Los cinco puntos representan los últimos resultados disponibles
                antes del partido, de más antiguo a más reciente. Combinan
                LaLiga, Champions y Premier League; los huecos indican que falta
                historial.
              </p>
              <p>
                La forma, las estadísticas y el global se calculan a 90 minutos
                más el descuento. No incluyen prórroga ni penaltis; el global
                reglamentario puede diferir del que decide la clasificación.
              </p>
              <p>
                Las estadísticas previas de temporada se limitan a la
                competición del encuentro. Al consultar un partido pasado, solo
                se consideran resultados anteriores a su inicio.
              </p>
              <p>
                En un partido finalizado puedes consultar los goles, el descanso
                y la segunda parte cuando hay datos disponibles. El ganador
                oficial se muestra por separado del marcador a 90 minutos si
                hubo prórroga o penaltis. La quiniela siempre puntúa a 90
                minutos.
              </p>
              <p>
                Los partidos muestran la hora de tu dispositivo. Los resultados
                se sincronizan cada 2 horas, con dos actualizaciones adicionales
                a las 21:10 y las 23:00 en hora peninsular española. La web
                consulta el calendario cada 5 minutos mientras está visible.
                SportAPI se comprueba cada 10 minutos cuando hay partidos
                próximos o recientes, para adelantar resultados y puntos. Puede
                haber retrasos del proveedor o de la tarea programada. Los
                puntos se recalculan con los partidos finalizados durante esa
                sincronización; vuelve a entrar en Clasificación para consultar
                los nuevos totales.
              </p>
            </div>
          </>
        )}
      </section>
      {user && (
        <div className="profile-signout">
          {logoutError && (
            <p className="error" role="alert">
              {logoutError}
            </p>
          )}
          <button
            className="text-button"
            disabled={signingOut || busy}
            onClick={() => void signOut()}
          >
            <LogOut size={14} />
            {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
      )}
    </>
  );
}
