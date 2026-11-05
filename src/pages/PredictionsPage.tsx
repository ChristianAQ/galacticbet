import { competitionCode, competitionName } from "../lib/competitions";
import { COMPETITION_CODES } from "../lib/competitions";
import type { User } from "firebase/auth";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { CalendarDays, ChevronDown, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import PageFilters from "../components/PageFilters";
import ConfirmQuiniela from "../components/ConfirmQuiniela";
import RoundDeliveryStatus from "../components/RoundDeliveryStatus";
import GroupPredictions from "../components/GroupPredictions";
import PredictionCard from "../components/PredictionCard";
import RoundSelector from "../components/RoundSelector";
import { Empty, PageTitle, readableError } from "../components/ui";
import {
  loadGameSeasons,
  loadParticipants,
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
import { preferenceStore } from "../lib/preferences";
import { roundOptions } from "../lib/roundOptions";
import { useGroupSelection } from "../lib/useGroupSelection";
import { useRoundDelivery } from "../lib/useRoundDelivery";

const demoPlayers: Participant[] = [
  { id: "demo-me", name: "Tú", avatar: null },
  { id: "demo-alex", name: "Alex Moreno", avatar: null },
  { id: "demo-marta", name: "Marta López", avatar: null },
  { id: "demo-dani", name: "Dani Ruiz", avatar: null },
];
export default function PredictionsPage({
  matches,
  groups,
  user,
  demo,
}: {
  matches: Match[];
  groups: Group[];
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [round, setRound] = useState("");
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
  const navigate = useNavigate();
  const requestedRound = searchParams.get("round") || "";
  const selected = rounds.some((r) => r.id === round)
    ? round
    : rounds.some((r) => r.id === requestedRound)
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
  const canSubmit =
    delivery.requiredIds.length > 0 &&
    delivery.deadline !== null &&
    !deadlineClosed &&
    completed > 0 &&
    missingOpen === 0 &&
    !pending &&
    !busy &&
    !submitting &&
    !isSealed;
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    setSeasons([]);
    setSeason("");
    setRound("");
    if (!db || !group || demo) return;
    let active = true;
    loadGameSeasons(group)
      .then((configs) => {
        if (!active) return;
        const next = [...configs];
        next.sort(
          (a, b) =>
            Number(b.competition === "PD") - Number(a.competition === "PD") ||
            b.id.localeCompare(a.id, "es", { numeric: true }),
        );
        setSeasons(next);
        setSeason(
          next.find((s) => s.competition === preferences.competition)?.id ||
            next[0]?.id ||
            "",
        );
      })
      .catch((e) => {
        if (active) setError(readableError(e));
      });
    return () => {
      active = false;
    };
  }, [group, demo]);
  useEffect(() => {
    setValues({});
    setValuesKey(predictionKey);
    setError("");
    if (!db || !group || !season || !selected || !user || demo) {
      setLoadingPredictions(false);
      return;
    }
    setLoadingPredictions(true);
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
    setSealed({ key: sealKey, value: false, sharing: false });
    setConfirm(false);
    setSubmitError("");
    if (!db || !group || !season || !selected || !user || demo) {
      setLoadingSeal(false);
      return;
    }
    setLoadingSeal(true);
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
    setParticipants([]);
    setPeopleError("");
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
  async function choose(match: Match, value: PredictionValue) {
    if (isSealed || busy || pending || submitting || deadlineClosed) return;
    setBusy(match.id);
    setError("");
    try {
      if (!demo) {
        if (!user || !group || !season)
          throw new Error("Selecciona un grupo y una competición.");
        await savePrediction(uid, group, season, match, value);
      }
      setValues((v) => ({ ...v, [match.id]: value }));
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy("");
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
      focusAfterSubmit.current = true;
      setConfirm(false);
    } catch (e) {
      setSubmitError(readableError(e));
    } finally {
      setSubmitting(false);
    }
  }
  // Remember the round in the URL so «Volver» returns to the same jornada.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const onDetails = useCallback(
    (id: string) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          next.set("round", selectedRef.current);
          return next;
        },
        { replace: true },
      );
      navigate(`/partido/${encodeURIComponent(id)}`);
    },
    [navigate, setSearchParams],
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
  const disabled = Boolean(busy) || pending || submitting;
  const selectorsDisabled = Boolean(busy) || submitting;
  return (
    <>
      <PageTitle
        eyebrow={`QUINIELA${list[0] ? ` · ${competitionName(list[0].competition).toUpperCase()}` : ""}`}
        title="Mi quiniela"
        description={
          !list.length
            ? "Selecciona tu grupo y la competición para ver tu quiniela."
            : pending
              ? "Comprobando tu pronóstico…"
              : isSealed
                ? "Pronóstico guardado · Tu apuesta está confirmada."
                : deadlineClosed
                  ? "Plazo cerrado · No has guardado tu pronóstico."
                  : completed > 0
                    ? "Pronóstico en curso · Completa y guarda tu quiniela."
                    : "Jornada abierta · Haz tu pronóstico antes del primer partido."
        }
      />
      <PageFilters
        groups={demo ? [] : groups}
        groupId={group}
        groupLabel={demo ? "Grupo de demostración" : undefined}
        onGroup={setGroup}
        disabled={selectorsDisabled}
        competition={competitionCode(
          demo ? demoCompetition : active?.competition,
        )}
        available={
          demo
            ? COMPETITION_CODES
            : COMPETITION_CODES.filter((code) =>
                seasons.some((s) => s.competition === code),
              )
        }
        onCompetition={(code) => {
          if (demo) setDemoCompetition(code);
          else {
            if (user) preferenceStore.update(user.uid, { competition: code });
            setSeason(seasons.find((s) => s.competition === code)?.id || "");
          }
          setRound("");
        }}
        aside={
          <span className="page-filters-chip">
            {mode === "classic" ? "1X2" : "Marcador exacto"}
          </span>
        }
      >
        {!demo &&
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
        !deadlineClosed &&
        !delivery.prepared &&
        !delivery.checking &&
        !delivery.error && (
          <p className="setup-notice">
            Esta jornada aún no está preparada para recibir entregas. Inténtalo
            más tarde.
          </p>
        )}
      {list.length ? (
        <>
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
          {!isSealed && (
            <section
              className="round-save-panel panel"
              aria-label="Estado de la quiniela"
              aria-busy={pending || submitting}
            >
              <div className="round-save-progress">
                <div className="round-progress-row">
                  <strong>
                    {completed}/{delivery.requiredIds.length}
                  </strong>
                  <span>
                    {deadlineClosed
                      ? "Plazo cerrado"
                      : pending
                        ? "Comprobando…"
                        : missingOpen > 0
                          ? `${missingOpen} pendientes`
                          : completed > 0
                            ? "Lista para guardar"
                            : "Sin pronósticos"}
                  </span>
                </div>
                <div
                  className="round-progress-track"
                  role="progressbar"
                  aria-label="Pronósticos completados"
                  aria-valuemin={0}
                  aria-valuemax={delivery.requiredIds.length}
                  aria-valuenow={completed}
                >
                  <span
                    style={{
                      width: `${delivery.requiredIds.length ? (completed / delivery.requiredIds.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <button
                className="button primary"
                disabled={!canSubmit}
                onClick={() => {
                  setSubmitError("");
                  setConfirm(true);
                }}
              >
                <Save size={16} />
                Guardar quiniela
              </button>
            </section>
          )}
          {!isSealed ? (
            <div
              id="mine-predictions"
              role="region"
              aria-label="Mi quiniela"
              aria-busy={pending}
              className="prediction-list"
            >
              {list.map((m) => (
                <PredictionCard
                  key={m.id}
                  match={m}
                  history={matches}
                  value={values[m.id]}
                  mode={mode}
                  lock={
                    isSealed
                      ? "sealed"
                      : deadlineClosed
                        ? "deadline"
                        : !canPredict(m.utcDate, clock, m.status)
                          ? "kickoff"
                          : null
                  }
                  disabled={disabled}
                  saving={busy === m.id}
                  demo={demo}
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
                ownValues={values}
                sealed={isSealed}
                loadingOwn={!demo && loadingPredictions}
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
              />
            </div>
          )}
        </>
      ) : (
        <Empty
          title={
            demo || active
              ? "Aún no hay partidos disponibles"
              : groups.length
                ? "Elige tu competición"
                : "Primero, reúne a tu equipo"
          }
        >
          {demo ? (
            "La demo contiene únicamente una jornada de LaLiga."
          ) : active ? (
            "Los partidos aparecerán cuando se sincronice el calendario de esta competición."
          ) : (
            <>
              <Link to="/grupos">
                Crea un grupo o únete con un código de invitación.
              </Link>
            </>
          )}
        </Empty>
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
