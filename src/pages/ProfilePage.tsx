import type { User } from "firebase/auth";
import {
  ArrowRight,
  ChevronRight,
  CircleHelp,
  LogIn,
  LogOut,
  NotebookPen,
  Plus,
  Shirt,
  SunMoon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import GroupList from "../components/GroupList";
import GroupActions from "../components/GroupActions";
import CompetitionLogo from "../components/CompetitionLogo";
import Segmented from "../components/Segmented";
import { FormGuide } from "../components/TeamForm";
import { Empty, PageTitle, readableError } from "../components/ui";
import { COMPETITION_CODES, competitionName } from "../lib/competitions";
import type { Group } from "../lib/data";
import { logout, saveDisplayName } from "../lib/firebase";
import { haptic, prefersReducedMotion } from "../lib/motion";
import { setTheme, useTheme, type Theme } from "../lib/theme";
import "../styles/profile.css";

type Tab = "profile" | "groups" | "play";
const tabs: { value: Tab; label: string }[] = [
  { value: "profile", label: "Mi ficha" },
  { value: "groups", label: "Mis grupos" },
  { value: "play", label: "Cómo jugar" },
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
  const requested = params.get("tab");
  const tab: Tab = tabs.some((t) => t.value === requested)
    ? (requested as Tab)
    : user
      ? "profile"
      : "play";
  const [name, setName] = useState(user?.displayName || "");
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [logoutError, setLogoutError] = useState("");
  // Effects re-run when the hidden page is shown again (<Activity>): only
  // reset the form when the account or its saved name really changed.
  const seen = useRef({ uid: user?.uid, name: user?.displayName });
  useEffect(() => {
    const last = seen.current;
    if (last.uid === user?.uid && last.name === user?.displayName) return;
    if (last.uid !== user?.uid) {
      setMessage("");
      setError("");
    }
    seen.current = { uid: user?.uid, name: user?.displayName };
    setName(user?.displayName || "");
  }, [user?.uid, user?.displayName]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await saveDisplayName(name);
      onUpdated();
      haptic("success");
      setMessage("Nombre actualizado. Así te verán en la tabla.");
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
  function select(id: Tab) {
    setParams({ tab: id }, { replace: true });
  }
  function openHelp() {
    haptic();
    select("play");
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }
  const initial = (user?.displayName || "Tú").trim().charAt(0).toUpperCase();
  return (
    <>
      <PageTitle
        eyebrow={user ? "Tu ficha" : "Vestuario"}
        title={user ? user.displayName || "Jugador" : "Tu rincón"}
        navTitle="Perfil"
        description={
          user
            ? user.email || "Jugador de GalacticBet"
            : "Entra para tener ficha, grupo y sitio en la tabla."
        }
        titleControl={
          <span className="profile-avatar" aria-hidden="true">
            {user?.photoURL ? (
              <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
            ) : (
              initial
            )}
          </span>
        }
      />
      <Segmented
        className="profile-tabs"
        label="Secciones de perfil"
        value={tab}
        options={tabs}
        onChange={select}
        tabs={{ idPrefix: "profile-tab", controls: "profile-panel" }}
      />
      <section
        role="tabpanel"
        id="profile-panel"
        className="profile-panel"
        aria-labelledby={`profile-tab-${tab}`}
        tabIndex={0}
        key={tab}
      >
        {tab === "profile" ? (
          user ? (
            <div className="profile-editor">
              <form onSubmit={save}>
                <label>
                  Nombre visible
                  <input
                    autoComplete="nickname"
                    autoCapitalize="words"
                    enterKeyHint="done"
                    required
                    maxLength={100}
                    value={name}
                    disabled={busy}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Como te llaman en el grupo"
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
            <Empty
              art="bench"
              title="Banquillo sin ficha"
              action={
                <button className="button primary" onClick={onLogin}>
                  Entrar <ArrowRight size={16} aria-hidden="true" />
                </button>
              }
            >
              Entra para elegir tu nombre de juego y ver tus grupos.
            </Empty>
          )
        ) : tab === "groups" ? (
          user ? (
            <>
              {groups.length ? (
                <GroupList groups={groups} uid={user.uid} />
              ) : (
                <Empty art="bench" title="Ningún grupo en la convocatoria">
                  Crea uno o únete al de tus amigos con su código de
                  invitación.
                </Empty>
              )}
              <GroupActions />
            </>
          ) : (
            <Empty
              art="bench"
              title="El fútbol se comparte"
              action={
                <button className="button primary" onClick={onLogin}>
                  Entrar <ArrowRight size={16} aria-hidden="true" />
                </button>
              }
            >
              Entra para ver los grupos a los que perteneces.
            </Empty>
          )
        ) : (
          <HowToPlay user={user} onLogin={onLogin} />
        )}
      </section>

      <section className="profile-more" aria-labelledby="profile-more-title">
        <div className="section-heading">
          <h2 id="profile-more-title">Más</h2>
        </div>
        <ul className="more-list">
          <MoreLink
            href="#/porra"
            icon={<NotebookPen size={20} aria-hidden="true" />}
            label="Porra rápida"
            detail="Un partido, vuestros marcadores"
          />
          <MoreLink
            href="#/equipos"
            icon={<Shirt size={20} aria-hidden="true" />}
            label="Equipos y jugadores"
            detail="Plantillas y alineaciones"
          />
        </ul>
        <p className="more-caption">Apariencia</p>
        <ul className="more-list">
          <li>
            <ThemeRow />
          </li>
        </ul>
        <p className="more-caption">Competiciones</p>
        <ul className="more-list">
          {COMPETITION_CODES.map((code) => (
            <MoreLink
              key={code}
              href={`#/ligas?competition=${code}`}
              icon={<CompetitionLogo code={code} small />}
              label={competitionName(code)}
            />
          ))}
        </ul>
        <p className="more-caption">Grupos</p>
        <ul className="more-list">
          <MoreLink
            href="#/grupos?action=create"
            icon={<Plus size={20} aria-hidden="true" />}
            label="Crear grupo"
            detail="Tú pones las reglas del vestuario"
          />
          <MoreLink
            href="#/grupos?join=1"
            icon={<LogIn size={20} aria-hidden="true" />}
            label="Unirme con un código"
          />
        </ul>
        <ul className="more-list">
          <li>
            <button type="button" className="more-row" onClick={openHelp}>
              <span className="more-icon">
                <CircleHelp size={20} aria-hidden="true" />
              </span>
              <span className="more-label">Ayuda y cómo jugar</span>
              <ChevronRight className="more-chevron" size={18} aria-hidden="true" />
            </button>
          </li>
          <li>
            {user ? (
              <button
                type="button"
                className="more-row is-destructive"
                disabled={signingOut || busy}
                onClick={() => void signOut()}
              >
                <span className="more-icon">
                  <LogOut size={20} aria-hidden="true" />
                </span>
                <span className="more-label">
                  {signingOut ? "Cerrando sesión…" : "Cerrar sesión"}
                </span>
              </button>
            ) : (
              <button type="button" className="more-row is-primary" onClick={onLogin}>
                <span className="more-icon">
                  <LogIn size={20} aria-hidden="true" />
                </span>
                <span className="more-label">Entrar o crear cuenta</span>
                <ChevronRight className="more-chevron" size={18} aria-hidden="true" />
              </button>
            )}
          </li>
        </ul>
        {logoutError && (
          <p className="error" role="alert">
            {logoutError}
          </p>
        )}
      </section>
    </>
  );
}

const themes: { value: Theme; label: string }[] = [
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];
function ThemeRow() {
  const theme = useTheme();
  return (
    <div className="more-row theme-row">
      <span className="more-icon">
        <SunMoon size={20} aria-hidden="true" />
      </span>
      <span className="more-label" id="theme-label">
        Tema
      </span>
      <Segmented
        label="Tema de la app"
        size="sm"
        className="theme-switch"
        value={theme}
        options={themes}
        onChange={setTheme}
      />
    </div>
  );
}

function MoreLink({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <li>
      <a className="more-row" href={href}>
        <span className="more-icon">{icon}</span>
        <span className="more-label">
          {label}
          {detail && <small>{detail}</small>}
        </span>
        <ChevronRight className="more-chevron" size={18} aria-hidden="true" />
      </a>
    </li>
  );
}

const steps = [
  "Crea un grupo o únete con el código de tus amigos. Los grupos nuevos incluyen LaLiga, Champions y Premier League.",
  "En Mi quiniela, elige tu grupo y pulsa el logo de la competición. Selecciona la jornada y completa tus pronósticos.",
  "Tus elecciones se conservan al aplicarlas. Puedes revisarlas hasta el inicio del primer partido de la jornada o hasta pulsar Guardar quiniela y confirmar el cierre definitivo de toda la jornada.",
  "Al guardar, la jornada pasa a El grupo y ya estás jugando. Tus pronósticos siguen visibles. Solo los miembros que hayan completado y guardado la jornada podrán compartir sus elecciones entre sí, también antes del inicio.",
  "Consulta los puntos de una jornada o el acumulado en Clasificación.",
];

function HowToPlay({ user, onLogin }: { user: User | null; onLogin: () => void }) {
  return (
    <div className="how-to-play">
      <section aria-labelledby="rules-title">
        <div className="section-heading">
          <h2 id="rules-title">Así puntúa</h2>
        </div>
        <table className="rules-table">
          <caption className="sr-only">Puntos por modalidad de juego</caption>
          <thead>
            <tr>
              <th scope="col">Modalidad</th>
              <th scope="col">Si aciertas</th>
              <th scope="col">Pts</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">
                Clásica <small>1X2</small>
              </th>
              <td>1 si gana el local, X el empate, 2 el visitante</td>
              <td>1</td>
            </tr>
            <tr>
              <th scope="row" rowSpan={2}>
                Marcador exacto <small>90 min</small>
              </th>
              <td>El marcador exacto</td>
              <td>3</td>
            </tr>
            <tr>
              <td>Solo el ganador o el empate</td>
              <td>1</td>
            </tr>
            <tr className="is-miss">
              <th scope="row">Cualquiera</th>
              <td>Un fallo</td>
              <td>0</td>
            </tr>
          </tbody>
        </table>
        <p className="rules-note">
          En marcador exacto los puntos no se acumulan: el máximo por partido
          es 3. La modalidad queda fija durante la temporada.
        </p>
      </section>

      <section aria-labelledby="steps-title">
        <div className="section-heading">
          <h2 id="steps-title">Así se juega</h2>
        </div>
        <ol className="how-to-steps">
          {steps.map((step, i) => (
            <li key={i}>
              <span className="step-number" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p>{step}</p>
            </li>
          ))}
        </ol>
        <p className="rules-note">
          Sin dinero de por medio en la app. Solo intuición, fútbol y rivalidad
          entre amigos.
        </p>
        {!user && (
          <button className="button primary" onClick={onLogin}>
            Empezar a jugar
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </section>

      <section id="bote" aria-labelledby="pot-title">
        <div className="section-heading">
          <h2 id="pot-title">Bote por jornada</h2>
        </div>
        <div className="rules-prose">
          <p>
            El administrador puede fijar una aportación por jugador (por
            ejemplo, 5 €). Cada miembro que guarda su quiniela de una jornada
            entra en el bote de esa jornada.
          </p>
          <p>
            Con 3 jugadores a 5 € el bote es de 15 €. Al terminar la jornada,
            quien más puntos haya sumado se lo lleva; si hay empate, se reparte
            a partes iguales.
          </p>
          <p className="rules-callout">
            Es solo informativo: GalacticBet no cobra, no guarda ni paga dinero,
            y no se queda ninguna comisión. Los pagos los organizáis entre
            vosotros.
          </p>
        </div>
      </section>

      <section aria-labelledby="data-title">
        <div className="section-heading">
          <h2 id="data-title">Forma y datos</h2>
        </div>
        <div className="rules-prose">
          <FormGuide />
          <p>
            Los cinco puntos representan los últimos resultados disponibles
            antes del partido, de más antiguo a más reciente. Combinan LaLiga,
            Champions y Premier League; los huecos indican que falta historial.
          </p>
          <p>
            La forma, las estadísticas y el global se calculan a 90 minutos más
            el descuento. No incluyen prórroga ni penaltis; el global
            reglamentario puede diferir del que decide la clasificación.
          </p>
          <p>
            Las estadísticas previas de temporada se limitan a la competición
            del encuentro. Al consultar un partido pasado, solo se consideran
            resultados anteriores a su inicio.
          </p>
          <p>
            En un partido finalizado puedes consultar los goles, el descanso y
            la segunda parte cuando hay datos disponibles. El ganador oficial se
            muestra por separado del marcador a 90 minutos si hubo prórroga o
            penaltis. La quiniela siempre puntúa a 90 minutos.
          </p>
          <p>
            Los partidos muestran la hora de tu dispositivo. Los resultados se
            sincronizan cada 2 horas, con dos actualizaciones adicionales a las
            21:10 y las 23:00 en hora peninsular española. La web consulta el
            calendario cada 5 minutos mientras está visible. SportAPI se
            comprueba cada 10 minutos cuando hay partidos próximos o recientes,
            para adelantar resultados y puntos. Puede haber retrasos del
            proveedor o de la tarea programada. Los puntos se recalculan con los
            partidos finalizados durante esa sincronización; vuelve a entrar en
            Clasificación para consultar los nuevos totales.
          </p>
        </div>
      </section>
    </div>
  );
}
