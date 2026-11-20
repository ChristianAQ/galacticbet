import { collection, documentId, getDocs, query, where } from "firebase/firestore";
import {
  ChevronDown,
  ChevronUp,
  Flame,
  Share2,
  Snowflake,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { db } from "../lib/firebase";
import { fromServer } from "../lib/firestoreOnline";
import type { Match, Mode, PredictionValue } from "../lib/domain";
import { decodeDelivery } from "../lib/roundDelivery";
import {
  rarestHit,
  recapHighlights,
  recapText,
  type RoundRecap as Recap,
} from "../lib/roundRecap";
import { shareFileName } from "../lib/shareSummary";
import { RankAvatar } from "./RankingWidgets";
import "../styles/recap.css";

const ShareDialog = lazy(() => import("./ShareDialog"));
const icons = {
  rare: Zap,
  perfect: Target,
  streak: Flame,
  climb: TrendingUp,
  blank: Snowflake,
};
const pts = (n: number) => `${n} ${n === 1 ? "punto" : "puntos"}`;

/**
 * Sealed slips of the round, when the rules let this player see them (they
 * sealed too). Used only for «the rarest hit»; silently absent otherwise.
 */
function useRoundEntries(groupId: string, roundId: string, members: string[]) {
  const [entries, setEntries] = useState<Record<string, Record<string, PredictionValue>> | null>(
    null,
  );
  const key = members.join();
  useEffect(() => {
    setEntries(null);
    if (!db || !roundId || !members.length || members.length > 30) return;
    let active = true;
    const seasonId = roundId.split("-").slice(0, 2).join("-");
    getDocs(
      query(
        collection(db, "groups", groupId, "gameSeasons", seasonId, "roundEntries", roundId, "players"),
        where(documentId(), "in", members),
      ),
    )
      .then(fromServer)
      .then(
        (snap) => {
          if (!active) return;
          const decoded: Record<string, Record<string, PredictionValue>> = {};
          for (const d of snap.docs) {
            try {
              decoded[d.id] = decodeDelivery(d.data());
            } catch {
              /* An unreadable slip just does not count. */
            }
          }
          setEntries(decoded);
        },
        () => {},
      );
    return () => {
      active = false;
    };
  }, [groupId, roundId, key]);
  return entries;
}

export default function RoundRecap({
  recap,
  title,
  shortTitle,
  groupId,
  groupName,
  members,
  mode,
  fixtures,
  showHits,
  userId,
}: {
  recap: Recap;
  /** «LaLiga · Jornada 13» */
  title: string;
  /** «J13» */
  shortTitle: string;
  groupId: string;
  groupName: string;
  members: string[];
  mode: Mode;
  fixtures: Match[];
  showHits: boolean;
  userId: string;
}) {
  const [sharing, setSharing] = useState(false);
  const entries = useRoundEntries(groupId, recap.roundId, members);
  // Lines about you speak to you on the card; the shared text names everyone.
  const { highlights, shared } = useMemo(() => {
    const names = new Map(recap.rows.map((r) => [r.id, r.name]));
    const rare = entries ? rarestHit(mode, fixtures, entries, names) : null;
    return {
      highlights: recapHighlights(recap, rare, userId),
      shared: recapHighlights(recap, rare),
    };
  }, [recap, entries, mode, fixtures, userId]);
  const { winners, best, me } = recap;
  const lead = winners[0];
  return (
    <section className="round-recap" aria-labelledby="round-recap-title">
      <header className="recap-head">
        <p className="recap-eyebrow">Resumen · {shortTitle}</p>
        <button type="button" className="recap-share" onClick={() => setSharing(true)}>
          <Share2 size={15} aria-hidden="true" />
          Compartir
        </button>
      </header>
      <div className="recap-winner">
        <span className="recap-trophy" aria-hidden="true">
          <Trophy size={22} strokeWidth={2.2} />
        </span>
        <div className="recap-winner-text">
          <h2 id="round-recap-title">
            {winners.length === 1
              ? `Ganó ${lead.name}`
              : `Empate: ${winners.map((w) => w.name).join(" y ")}`}
          </h2>
          <p>
            {pts(best)}
            {showHits && winners.length === 1
              ? ` · ${lead.hits} ${lead.hits === 1 ? "acierto" : "aciertos"}`
              : ""}
          </p>
        </div>
        <span className="recap-winner-faces" aria-hidden="true">
          {winners.slice(0, 3).map((w) => (
            <RankAvatar key={w.id} name={w.name} avatar={w.avatar} />
          ))}
        </span>
      </div>
      {me && (
        <dl className="recap-me" aria-label="Tu jornada">
          <div>
            <dt>Tu jornada</dt>
            <dd>{me.points > 0 ? `+${me.points}` : "0"}</dd>
          </div>
          <div>
            <dt>Puesto</dt>
            <dd>
              <span className="recap-num">
                {me.roundPosition}
                <i>º</i>
              </span>
            </dd>
          </div>
          <div>
            <dt>General</dt>
            <dd>
              <span className="recap-num">
                {me.seasonPosition}
                <i>º</i>
              </span>
              {me.moved !== 0 && (
                <span
                  className={`recap-move ${me.moved > 0 ? "is-up" : "is-down"}`}
                  aria-label={`${me.moved > 0 ? "Subes" : "Bajas"} ${Math.abs(me.moved)}`}
                >
                  {me.moved > 0 ? (
                    <ChevronUp size={13} strokeWidth={2.6} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={13} strokeWidth={2.6} aria-hidden="true" />
                  )}
                  {Math.abs(me.moved)}
                </span>
              )}
            </dd>
          </div>
        </dl>
      )}
      {highlights.length > 0 && (
        <ul className="recap-highlights">
          {highlights.map((h) => {
            const Icon = icons[h.kind];
            return (
              <li key={h.kind} className={`is-${h.kind}`}>
                <Icon size={16} aria-hidden="true" />
                <span>{h.text}</span>
              </li>
            );
          })}
        </ul>
      )}
      {sharing && (
        <Suspense fallback={null}>
          <ShareDialog
            title={`Resumen · ${groupName}`}
            filename={shareFileName("resumen", groupName, title)}
            text={recapText({ groupName, title, recap, highlights: shared })}
            render={() =>
              import("../lib/shareImage").then((m) =>
                m.standingsImage({
                  groupName,
                  title: `${title} · Así queda la general`,
                  rows: recap.season,
                  showHits,
                }),
              )
            }
            onClose={() => setSharing(false)}
          />
        </Suspense>
      )}
    </section>
  );
}
