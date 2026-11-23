import { competitionCode, competitionName } from "../lib/competitions";
import { COMPETITION_CODES } from "../lib/competitions";
import type { AppUser as User } from "../lib/session";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Coins,
  Stamp,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import GroupActions from "../components/GroupActions";
import { CustomChips } from "../components/CustomChips";
import PageFilters from "../components/PageFilters";
import ConfirmQuiniela from "../components/ConfirmQuiniela";
import RoundDeliveryStatus from "../components/RoundDeliveryStatus";
import GroupPredictions from "../components/GroupPredictions";
import PredictionCard from "../components/PredictionCard";
import RoundSelector from "../components/RoundSelector";
import { Empty, PageTitle, readableError } from "../components/ui";
import { SkeletonRows } from "../components/Skeleton";
import {
  loadGameSeasons,
  loadParticipants,
  SEASONS_CHANGED,
  savePrediction,
  submitRound,
  type Group,
  type Participant,
} from "../lib/data";
import {
  canPredict,
  preferredRound,
  roundLabel,
  type Match,
  type Mode,
  type PredictionValue,
} from "../lib/domain";
import { db } from "../lib/firebase";
import { useFollowedCompetitions } from "../lib/followedCompetitions";
import { preferenceStore } from "../lib/preferences";
import { roundOptions } from "../lib/roundOptions";
import { useGroupSelection } from "../lib/useGroupSelection";
import { useRoundDelivery } from "../lib/useRoundDelivery";
import { useStuck } from "../lib/useStuck";
import { PotAmount } from "../components/PotCard";
import { euroShort, groupPotCents } from "../lib/pot";
import { euro } from "../lib/porra";
import { go } from "../lib/navigation";
import { haptic } from "../lib/motion";
import "../styles/quiniela.css";

const CustomQuiniela = lazy(() => import("../components/CustomQuiniela"));

const sameValue = (a?: PredictionValue, b?: PredictionValue) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A slip that was never sealed doesn't count: the board shows none of it. */
const NO_PICKS: Record<string, PredictionValue> = {};

/** Demo groups show a 5 € pot so the feature can be explored without an account. */
const DEMO_POT_CENTS = 500;

const demoPlayers: Participant[] = [
  { id: "demo-me", name: "Tú", avatar: null },
  { id: "demo-alex", name: "Alex Moreno", avatar: null },
  { id: "demo-marta", name: "Marta López", avatar: null },
  { id: "demo-dani", name: "Dani Ruiz", avatar: null },
];
export default function PredictionsPage({
  matches,
  groups,
  groupsReady,
  user,
  demo,
}: {
  matches: Match[];
  groups: Group[];
  /** Your groups have loaded (an empty list means you really have none). */
  groupsReady: boolean;
  user: User | null;
  demo: boolean;
}) {
  const {
    groupId: group,
    selectGroup: setGroup,
    preferences,
  } = useGroupSelection(demo ? "" : user?.uid || "", demo ? [] : groups);
  const [demoCompetition, setDemoCompetition] = useState("PD");
  const [season, setSeason] = useState("");
  const [seasons, setSeasons] = useState<
    { id: string; mode: Mode; competition: string }[]
  >([]);
  const [storedValues, setValues] = useState<Record<string, PredictionValue>>(
    {},
  );
  const [valuesKey, setValuesKey] = useState("");
  // Optimistic picks: each match tracks its own pending save.
  const [saving, setSaving] = useState<Record<string, number>>({});
  const savingCount = Object.keys(saving).length;
  const [seasonsLoading, setSeasonsLoading] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(Date.now());
  const [loadingPredictions, setLoadingPredictions] = useState(!demo);
  const [loadingSeal, setLoadingSeal] = useState(!demo);
  const [sealed, setSealed] = useState({
    key: "",
    value: false,
    sharing: false,
  });
  const [demoSeals, setDemoSeals] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const focusAfterSubmit = useRef(false);
  /*
   * The page lives in an <Activity>: when it is shown again React re-runs every
   * effect. State only resets when its key really changed; listeners resubscribe.
   */
  const lastKeys = useRef({ seasons: "", loaded: "", picks: "", seal: "", people: "" });
  const [submitError, setSubmitError] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [peopleError, setPeopleError] = useState("");
  const uid = demo ? "demo-me" : user?.uid || "demo-me";
  const selectedGroup = groups.find((g) => g.id === group);
  const active = seasons.find((s) => s.id === season);
  const activeCompetition = active?.competition;
  const mode: Mode = demo ? "classic" : active?.mode || "classic";
  const filtered = useMemo(
    () =>
      matches.filter((m) =>
        demo
          ? m.competition === demoCompetition
          : m.competition === activeCompetition && m.seasonId === season,
      ),
    [matches, demo, demoCompetition, activeCompetition, season],
  );
  // Round states only change at minute granularity; avoid recomputing every second.
  const minute = Math.floor(clock / 60_000);
  const rounds = useMemo(() => roundOptions(filtered), [filtered, minute]);
  const current = useMemo(() => preferredRound(filtered), [filtered, minute]);
  const [searchParams, setSearchParams] = useSearchParams();
  // The progress panel pins under the app bar and slims down while scrolling.
  const { sentinel: saveSentinel, stuck: saveStuck } = useStuck();
  const requestedRound = searchParams.get("round") || "";
  /*
   * The round lives in the URL only: a page shown again, «Volver», a reminder
   * or a link always land on the round it names, never on a stale one.
   */
  const setRound = (id: string) =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) next.set("round", id);
        else next.delete("round");
        return next;
      },
      { replace: true },
    );
  // Your friends' competitions sit next to LaLiga, Champions and Premier.
  const followed = useFollowedCompetitions(demo ? "" : user?.uid || "");
  // Without a group the official competitions have no slip: open your league.
  const liga =
    demo || !user
      ? ""
      : searchParams.get("liga") ||
        (groupsReady && !groups.length ? followed[0]?.id || "" : "");
  const ligaInfo = followed.find((c) => c.id === liga);
  const openLiga = (id: string) =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("liga", id);
        next.delete("round");
        return next;
      },
      { replace: true },
    );
  const closeLiga = () =>
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete("liga");
        next.delete("round");
        return next;
      },
      { replace: true },
    );
  // Arriving from a reminder while the page is open: switch to its season.
  useEffect(() => {
    const target = seasons.find((s) => requestedRound.startsWith(`${s.id}-`));
    if (target && target.id !== season) setSeason(target.id);
  }, [requestedRound, seasons]);
  const selected = rounds.some((r) => r.id === requestedRound)
    ? requestedRound
    : current;
  const list = useMemo(
    () => filtered.filter((m) => m.roundId === selected),
    [filtered, selected],
  );
  const predictionKey = `${uid}:${group}:${season}:${selected}`;
  const sealKey = predictionKey;
  const values = demo || valuesKey === predictionKey ? storedValues : {};
  const isSealed = demo
    ? Boolean(demoSeals[selected])
    : sealed.key === sealKey && sealed.value;
  const canShare = isSealed && (demo || sealed.sharing);
  const delivery = useRoundDelivery({
    groupId: group,
    seasonId: season,
    roundId: selected,
    userId: uid,
    matches: list,
    demo,
    demoSealed: isSealed,
  });
  const deadlineClosed =
    delivery.deadline !== null && clock >= delivery.deadline;
  // Nothing left to fill in: the round is shown as the group board, sealed or not.
  const roundClosed =
    deadlineClosed ||
    (list.length > 0 &&
      !list.some((m) => canPredict(m.utcDate, clock, m.status)));
  const sealKnown = demo || (sealed.key === sealKey && !loadingSeal);
  const showBoard = isSealed || roundClosed;
  const missed = roundClosed && sealKnown && !isSealed;
  const potCents = demo ? DEMO_POT_CENTS : groupPotCents(selectedGroup);
  const potMembers = new Set(
    demo
      ? demoPlayers.map((p) => p.id).concat(uid)
      : selectedGroup?.memberIds || [],
  );
  const potPlayers = delivery.completedIds.filter((id) =>
    potMembers.has(id),
  ).length;
  const required = list.filter((match) =>
    delivery.requiredIds.includes(match.id),
  );
  const pending =
    !demo &&
    (loadingPredictions ||
      loadingSeal ||
      !delivery.prepared ||
      valuesKey !== predictionKey ||
      sealed.key !== sealKey);
  const completed = required.filter((m) => values[m.id]).length;
  const missingOpen = delivery.requiredIds.length - completed;
  const saveStatus = deadlineClosed
    ? "Plazo cerrado"
    : pending
      ? "Comprobando…"
      : savingCount > 0
        ? "Anotando…"
        : missingOpen > 0
          ? null
          : completed > 0
            ? "Listo para sellar"
            : "Boleto en blanco";
  const canSubmit =
    delivery.requiredIds.length > 0 &&
    delivery.deadline !== null &&
    !deadlineClosed &&
    completed > 0 &&
    missingOpen === 0 &&
    !pending &&
    savingCount === 0 &&
    !submitting &&
    !isSealed;
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  // The group gained a competition (new season) after its list was shown.
  const [seasonsVersion, setSeasonsVersion] = useState(0);
  useEffect(() => {
    const reload = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== group) return;
      lastKeys.current.loaded = "";
      setSeasonsVersion((n) => n + 1);
    };
    window.addEventListener(SEASONS_CHANGED, reload);
    return () => window.removeEventListener(SEASONS_CHANGED, reload);
  }, [group]);
  useEffect(() => {
    const key = `${group}|${demo}`;
    const changed = lastKeys.current.seasons !== key;
    lastKeys.current.seasons = key;
    if (changed) {
      setSeasons([]);
      setSeason("");
      setSeasonsLoading(false);
    }
    if (!db || !group || demo) return;
    // Season configs are fixed for the season: a revealed page keeps them.
    if (!changed && lastKeys.current.loaded === key) return;
    let active = true;
    setSeasonsLoading(true);
    loadGameSeasons(group)
      .then((configs) => {
        if (!active) return;
        lastKeys.current.loaded = key;
        const next = [...configs];
        next.sort(
          (a, b) =>
            Number(b.competition === "PD") - Number(a.competition === "PD") ||
            b.id.localeCompare(a.id, "es", { numeric: true }),
        );
        setSeasons(next);
        // A reminder links to its round: open that competition's season.
        const linked = new URLSearchParams(window.location.hash.split("?")[1] || "").get("round") || "";
        setSeason(
          next.find((s) => linked.startsWith(`${s.id}-`))?.id ||
            next.find((s) => s.competition === preferences.competition)?.id ||
            next[0]?.id ||
            "",
        );
      })
      .catch((e) => {
        if (active) setError(readableError(e));
      })
      .finally(() => {
        if (active) setSeasonsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [group, demo, seasonsVersion]);
  useEffect(() => {
    const key = `${predictionKey}|${demo}`;
    const previous = lastKeys.current.picks;
    const changed = previous !== key;
    lastKeys.current.picks = key;
    if (changed) {
      // Demo picks only live here, for every round: keep them while exploring.
      if (!(demo && previous.endsWith("|true"))) setValues({});
      setValuesKey(predictionKey);
      setSaving({});
      setError("");
    }
    if (!db || !group || !season || !selected || !user || demo) {
      setLoadingPredictions(false);
      return;
    }
    if (changed) setLoadingPredictions(true);
    return onSnapshot(
      query(
        collection(db, "groups", group, "gameSeasons", season, "predictions"),
        where("userId", "==", uid),
        where("roundId", "==", selected),
      ),
      { includeMetadataChanges: true },
      (snap) => {
        setValues(
          Object.fromEntries(
            snap.docs.map((d) => [d.data().matchId, d.data().value]),
          ),
        );
        setLoadingPredictions(snap.metadata.fromCache);
      },
      (e) => {
        setError(readableError(e));
        setLoadingPredictions(false);
      },
    );
  }, [group, season, selected, uid, demo]);
  useEffect(() => {
    const key = `${sealKey}|${demo}`;
    const changed = lastKeys.current.seal !== key;
    lastKeys.current.seal = key;
    if (changed) {
      setSealed({ key: sealKey, value: false, sharing: false });
      setConfirm(false);
      setSubmitError("");
    }
    if (!db || !group || !season || !selected || !user || demo) {
      setLoadingSeal(false);
      return;
    }
    if (changed) setLoadingSeal(true);
    return onSnapshot(
      doc(
        db,
        "groups",
        group,
        "gameSeasons",
        season,
        "submissions",
        uid,
        "rounds",
        selected,
      ),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.metadata.hasPendingWrites)
          setSealed({
            key: sealKey,
            value: snap.exists(),
            sharing: snap.data()?.formatVersion === 2,
          });
        setLoadingSeal(snap.metadata.fromCache);
      },
      () => {
        setError(
          "No podemos comprobar ahora el estado de tu quiniela. Comprueba la conexión y vuelve a entrar antes de guardar.",
        );
        setLoadingSeal(true);
      },
    );
  }, [group, season, selected, uid, demo]);
  useEffect(() => {
    const key = demo
      ? "demo"
      : `${selectedGroup?.id}|${selectedGroup?.memberIds.join()}`;
    if (lastKeys.current.people !== key) {
      setParticipants([]);
      setPeopleError("");
    }
    lastKeys.current.people = key;
    if (demo) return;
    if (!selectedGroup) return;
    let active = true;
    loadParticipants(selectedGroup)
      .then((next) => {
        if (active) setParticipants(next);
      })
      .catch((e) => {
        if (active) setPeopleError(readableError(e));
      });
    return () => {
      active = false;
    };
  }, [selectedGroup, demo]);
  /**
   * Optimistic pick: the slip shows it at once and the other matches stay
   * playable. A failed save puts back the previous pick of that match only,
   * unless you already changed it again.
   */
  async function choose(match: Match, value: PredictionValue) {
    if (isSealed || pending || submitting || deadlineClosed) return;
    const previous = values[match.id];
    if (sameValue(previous, value)) return;
    setError("");
    setValues((v) => ({ ...v, [match.id]: value }));
    if (demo) return;
    setSaving((s) => ({ ...s, [match.id]: (s[match.id] || 0) + 1 }));
    try {
      if (!user || !group || !season)
        throw new Error("Selecciona un grupo y una competición.");
      await savePrediction(uid, group, season, match, value);
    } catch (e) {
      haptic("warning");
      setValues((v) => {
        if (!sameValue(v[match.id], value)) return v;
        const next = { ...v };
        if (previous === undefined) delete next[match.id];
        else next[match.id] = previous;
        return next;
      });
      setError(
        `No se anotó ${match.home} – ${match.away}: ${readableError(e)}`,
      );
    } finally {
      setSaving((s) => {
        const next = { ...s };
        if ((next[match.id] || 0) > 1) next[match.id]--;
        else delete next[match.id];
        return next;
      });
    }
  }
  async function finalize() {
    if (!canSubmit) {
      setSubmitError(
        deadlineClosed
          ? "El plazo ha terminado: la jornada se cierra al inicio del primer partido."
          : "Espera a que se comprueben tus elecciones antes de confirmar.",
      );
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      if (demo) setDemoSeals((v) => ({ ...v, [selected]: true }));
      else {
        await submitRound(
          uid,
          group,
          season,
          selected,
          Object.fromEntries(
            required
              .filter((m) => values[m.id])
              .map((m) => [m.id, values[m.id]]),
          ),
        );
        setSealed({ key: sealKey, value: true, sharing: true });
      }
      haptic("success");
      focusAfterSubmit.current = true;
      setConfirm(false);
    } catch (e) {
      haptic("warning");
      setSubmitError(readableError(e));
    } finally {
      setSubmitting(false);
    }
  }
  // Remember the round in the URL so «Volver» returns to the same jornada.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onDetails = useCallback(
    (id: string, from: Element | null) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("round", selectedRef.current);
          return next;
        },
        { replace: true },
      );
      go(`/partido/${encodeURIComponent(id)}`, { sharedFrom: from });
    },
    [setSearchParams],
  );
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const onChoose = useCallback(
    (match: Match, value: PredictionValue) =>
      void chooseRef.current(match, value),
    [],
  );
  useEffect(() => {
    // Loading an existing delivery must not steal focus or highlight the whole list.
    if (isSealed && !submitting && focusAfterSubmit.current) {
      focusAfterSubmit.current = false;
      setConfirm(false);
      document
        .querySelector<HTMLElement>("#group-predictions .group-view-heading h2")
        ?.focus({ preventScroll: true });
    }
  }, [isSealed, submitting]);
  const disabled = pending || submitting;
  const selectorsDisabled = savingCount > 0 || submitting;
  const total = delivery.requiredIds.length;
  const progress = total ? completed / total : 0;
  const status = !list.length
    ? "Elige grupo y competición y aparecerá tu boleto."
    : isSealed
      ? "Boleto sellado. Ahora, a sufrir con el grupo."
      : missed
        ? "Plazo cerrado: esta jornada se te escapó."
        : pending
          ? "Comprobando tu boleto…"
          : completed > 0
            ? "A medio rellenar. Séllalo antes del primer pitido."
            : "Jornada abierta. Marca tus signos antes del primer partido.";
  return (
    <>
      <PageTitle
        eyebrow={
          liga
            ? `Quiniela · ${ligaInfo?.name || "Tu liga"}`
            : `Quiniela${list[0] ? ` · ${competitionName(list[0].competition, true)}` : ""}`
        }
        title="Mi quiniela"
        description={
          liga
            ? "Tu liga entre amigos: pronostica cada partido antes de que empiece."
            : status
        }
      />
      <PageFilters
        groups={demo || liga ? [] : groups}
        groupId={group}
        groupLabel={
          demo ? "Grupo de demostración" : liga ? "Seguidores" : undefined
        }
        onGroup={setGroup}
        disabled={selectorsDisabled}
        competition={
          liga
            ? "none"
            : competitionCode(demo ? demoCompetition : active?.competition)
        }
        chips={
          followed.length > 0 && (
            <CustomChips
              list={followed}
              current={liga}
              onSelect={(id) => {
                if (id !== liga) haptic();
                openLiga(id);
              }}
            />
          )
        }
        available={
          demo
            ? COMPETITION_CODES
            : COMPETITION_CODES.filter((code) =>
                seasons.some((s) => s.competition === code),
              )
        }
        onCompetition={(code) => {
          // One URL update: leaving your league also forgets its round.
          if (liga) closeLiga();
          else setRound("");
          if (demo) setDemoCompetition(code);
          else {
            if (user) preferenceStore.update(user.uid, { competition: code });
            setSeason(seasons.find((s) => s.competition === code)?.id || "");
          }
        }}
        aside={
          <span className="page-filters-chip">
            {(liga ? ligaInfo?.predictionMode || mode : mode) === "classic"
              ? "1X2"
              : "Marcador exacto"}
          </span>
        }
      >
        {!demo &&
          !liga &&
          seasons.filter((s) => s.competition === active?.competition).length >
            1 && (
            <label className="group-picker page-filters-season">
              <CalendarDays size={16} aria-hidden="true" />
              <span className="sr-only">Temporada de la competición</span>
              <select
                value={season}
                disabled={selectorsDisabled}
                onChange={(e) => {
                  setSeason(e.target.value);
                  setRound("");
                }}
              >
                {seasons
                  .filter((s) => s.competition === active?.competition)
                  .map((s) => {
                    const year = Number(s.id.split("-")[1]);
                    return (
                      <option key={s.id} value={s.id}>
                        Temporada {year} / {year + 1}
                      </option>
                    );
                  })}
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </label>
          )}
      </PageFilters>
      {liga && user ? (
        <Suspense fallback={<SkeletonRows rows={5} label="Preparando tu boleto" />}>
          <CustomQuiniela key={liga} cid={liga} user={user} />
        </Suspense>
      ) : (
      <>
      {(demo || active) && (
        <RoundSelector
          rounds={rounds}
          value={selected}
          current={current}
          disabled={selectorsDisabled}
          onChange={setRound}
        />
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {delivery.error && (
        <p className="error" role="alert">
          {delivery.error}
        </p>
      )}
      {!demo &&
        !isSealed &&
        !roundClosed &&
        !delivery.prepared &&
        !delivery.checking &&
        !delivery.error && (
          <p className="setup-notice">
            Esta jornada todavía no admite boletos. Vuelve en un rato.
          </p>
        )}
      {list.length ? (
        <>
          {potCents > 0 && (
            <Link
              className="pot-chip"
              to={
                demo
                  ? "/perfil?tab=play"
                  : `/clasificacion?group=${encodeURIComponent(group)}`
              }
              aria-label={`Bote de la jornada: ${euro(potCents * potPlayers)}, ${potPlayers} ${potPlayers === 1 ? "jugador" : "jugadores"}. Ver detalle`}
            >
              <span className="pot-chip-icon" aria-hidden="true">
                <Coins size={18} />
              </span>
              <span className="pot-chip-text" aria-hidden="true">
                <strong>Bote de la jornada</strong>
                <small>
                  {potPlayers} × {euroShort(potCents)} ·{" "}
                  {delivery.completedIds.includes(uid)
                    ? "Ya estás dentro"
                    : deadlineClosed
                      ? "Esta vez te quedaste fuera"
                      : "Entras al sellar tu boleto"}
                </small>
              </span>
              <PotAmount cents={potCents * potPlayers} />
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
          )}
          <RoundDeliveryStatus
            key={`${group}:${list[0]?.roundId}`}
            memberIds={
              demo
                ? demoPlayers.map((person) => person.id)
                : selectedGroup?.memberIds || []
            }
            participants={demo ? demoPlayers : participants}
            completedIds={delivery.completedIds}
            ready={delivery.attendanceReady}
            deadline={delivery.deadline}
            clock={clock}
            userId={uid}
          />
          {!showBoard && <div ref={saveSentinel} className="sticky-sentinel" />}
          {!showBoard && (
            <section
              className={`round-save-panel${saveStuck ? " is-stuck" : ""}${canSubmit ? " is-ready" : ""}`}
              aria-label="Estado de tu boleto"
              aria-busy={pending || submitting || savingCount > 0}
            >
              <div className="round-save-progress">
                <strong className="round-save-count" aria-hidden="true">
                  {completed}
                  <small>/{total}</small>
                </strong>
                <div className="round-progress-row">
                  {/* The count already says what is missing; only states that
                      the number cannot tell get a line. */}
                  {saveStatus && <span>{saveStatus}</span>}
                  <div
                    className="round-progress-track"
                    role="progressbar"
                    aria-label="Pronósticos completados"
                    aria-valuemin={0}
                    aria-valuemax={total}
                    aria-valuenow={completed}
                  >
                    <span style={{ transform: `scaleX(${progress})` }} />
                  </div>
                </div>
              </div>
              <button
                className="button primary"
                disabled={!canSubmit}
                onClick={() => {
                  haptic();
                  setSubmitError("");
                  setConfirm(true);
                }}
              >
                <Stamp size={17} aria-hidden="true" />
                <span>
                  Sellar<span className="round-save-long"> boleto</span>
                </span>
              </button>
            </section>
          )}
          {!showBoard ? (
            <div
              id="mine-predictions"
              role="region"
              aria-label="Mi quiniela"
              aria-busy={pending}
              className="prediction-list slip"
            >
              {list.map((m, index) => (
                <PredictionCard
                  key={m.id}
                  number={index + 1}
                  match={m}
                  history={matches}
                  value={values[m.id]}
                  mode={mode}
                  lock={
                    !canPredict(m.utcDate, clock, m.status) ? "kickoff" : null
                  }
                  disabled={disabled}
                  saving={Boolean(saving[m.id])}
                  onChoose={onChoose}
                  onDetails={onDetails}
                />
              ))}
            </div>
          ) : (
            <div id="group-predictions" role="region" aria-label="El grupo">
              {peopleError && (
                <p className="error" role="alert">
                  {peopleError}
                </p>
              )}
              <GroupPredictions
                key={`${uid}:${group}:${season}:${selected}`}
                matches={list}
                history={matches}
                participants={demo ? demoPlayers : participants}
                userId={uid}
                groupId={group}
                seasonId={season}
                clock={clock}
                demo={demo}
                ownValues={isSealed ? values : NO_PICKS}
                sealed={isSealed}
                missed={missed}
                loadingOwn={!demo && (loadingPredictions || !sealKnown)}
                canShare={canShare}
                roundId={selected}
                completedIds={delivery.completedIds}
                mode={mode}
                groupName={
                  demo
                    ? "Grupo de demostración"
                    : selectedGroup?.name || "Grupo"
                }
                roundTitle={`${competitionName(list[0].competition)} · ${roundLabel(list[0])}`}
                onOpen={onDetails}
              />
            </div>
          )}
        </>
      ) : !demo && user && groups.length > 0 && seasonsLoading ? (
        <SkeletonRows rows={5} label="Preparando tu boleto" />
      ) : (
        <Empty
          art={!demo && user && !groups.length ? "bench" : "slip"}
          title={
            demo || active
              ? "Boleto sin partidos"
              : groups.length
                ? "Elige tu competición"
                : "Banquillo vacío"
          }
          action={!demo && user && !groups.length ? <GroupActions /> : undefined}
        >
          {demo
            ? "La demo solo trae una jornada de LaLiga."
            : active
              ? "Los partidos aparecerán en cuanto se sincronice el calendario de esta competición."
              : groups.length
                ? "Toca el escudo de una competición y aparecerá tu boleto."
                : followed.length
                  ? "Toca tu liga arriba y aparecerá su boleto. Para LaLiga, Champions y Premier hace falta un grupo: crea el tuyo o únete con el código de un amigo."
                  : "Para rellenar boletos hace falta un grupo. Crea el tuyo o únete con el código de un amigo."}
        </Empty>
      )}
      </>
      )}
      {confirm && (
        <ConfirmQuiniela
          matches={required}
          values={values}
          busy={submitting}
          demo={demo}
          error={submitError}
          onCancel={() => {
            if (!submitting) setConfirm(false);
          }}
          onConfirm={() => void finalize()}
        />
      )}
    </>
  );
}
