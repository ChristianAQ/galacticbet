import { createMatchupRecovery, mergeMatchups } from "./matchupRecovery";
import { probabilityFromOdds } from "../src/lib/matchProbability";
import { COMPETITION_CODES } from "../src/lib/competitions";
import type { Firestore } from "firebase-admin/firestore";
import type { Match } from "../src/lib/domain";
import {
  insightFitsMatch,
  validMatchInsight,
  type MatchInsight,
} from "../src/lib/matchInsightsData";
import { isHotMatch } from "../src/lib/liveBoard";
import {
  createEspnClient,
  EspnRequestError,
  eventFitsMatch,
  findEspnEvent,
  normalizeEspnSummary,
  type EspnClient,
  type EspnEvent,
} from "./espn";

const HOUR = 3_600_000;
const MAX_DOCUMENT_READS = 80;
const MAX_SUMMARIES = 24;
export interface StoredMatchInsight {
  insight: MatchInsight | null;
  checkedAt: string;
  kickoff: string;
  status: string;
  matchupsCheckedAt?: string;
}
interface SyncOptions {
  now?: number;
  client?: EspnClient;
  log?: (message: string) => void;
  /** Live loop: shorter refresh for fixtures in play (events, cards). */
  liveRefreshMs?: number;
  /** Live loop: ESPN identities already matched, avoiding repeated scoreboards. */
  events?: Map<string, EspnEvent>;
  /** Final stored state of every candidate, refreshed or not. */
  onInsight?: (matchId: string, insight: MatchInsight | null) => void;
}
export function insightRefreshInterval(
  match: Match,
  now: number,
  insight?: MatchInsight | null,
) {
  if (match.status === "FINISHED")
    return now - Date.parse(match.utcDate) > 48 * HOUR &&
      insight?.statistics.length
      ? 7 * 24 * HOUR
      : 24 * HOUR;
  return Date.parse(match.utcDate) - now > 2 * HOUR ? 12 * HOUR : 2 * HOUR;
}
export function insightCandidates(matches: Match[], now: number) {
  const seen = new Set<string>();
  const valid = matches.filter((match) => {
    if (
      !COMPETITION_CODES.some((code) => code === match.competition) ||
      !/^[a-zA-Z0-9_-]{1,100}$/.test(match.id) ||
      seen.has(match.id) ||
      !Number.isFinite(Date.parse(match.utcDate))
    )
      return false;
    seen.add(match.id);
    return true;
  });
  // Round start, rather than the last postponed fixture, determines round order.
  const rounds = new Map<
    string,
    { season: string; competition: Match["competition"]; start: number }
  >();
  for (const match of valid) {
    const key = `${match.seasonId}:${match.roundId}`;
    const previous = rounds.get(key);
    rounds.set(key, {
      season: match.seasonId,
      competition: match.competition,
      start: Math.min(previous?.start ?? Infinity, Date.parse(match.utcDate)),
    });
  }
  const recentRounds = new Set<string>();
  for (const code of COMPETITION_CODES) {
    const seasons = [
      ...new Set(
        valid.filter((m) => m.competition === code).map((m) => m.seasonId),
      ),
    ].sort();
    const season = seasons.at(-1);
    const started = [...rounds.entries()]
      .filter(
        ([, r]) =>
          r.competition === code && r.season === season && r.start <= now,
      )
      .sort((a, b) => b[1].start - a[1].start);
    for (const [key] of started.slice(0, 2)) recentRounds.add(key);
  }
  const recent = valid
    .filter(
      (m) =>
        Date.parse(m.utcDate) >= now - 48 * HOUR &&
        Date.parse(m.utcDate) <= now + 24 * HOUR &&
        ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED"].includes(
          m.status,
        ),
    )
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.utcDate) - now) -
          Math.abs(Date.parse(b.utcDate) - now) || a.id.localeCompare(b.id),
    );
  const archive = valid
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        Date.parse(m.utcDate) < now - 48 * HOUR &&
        recentRounds.has(`${m.seasonId}:${m.roundId}`),
    )
    .sort(
      (a, b) =>
        Date.parse(b.utcDate) - Date.parse(a.utcDate) ||
        a.id.localeCompare(b.id),
    );
  // Reserve room for past rounds and rotate overflow, so large UCL rounds cannot starve.
  const offset =
    archive.length > 40
      ? (Math.floor(now / (2 * HOUR)) * 40) % archive.length
      : 0;
  const history = [...archive.slice(offset), ...archive.slice(0, offset)];
  const selected = [
    ...recent.slice(0, 40),
    ...history.slice(0, 40),
    ...recent.slice(40),
    ...history.slice(40),
  ];
  return selected.slice(0, MAX_DOCUMENT_READS);
}

export function insightCalendarWindows(matches: Match[]) {
  const windows: {
    competition: Match["competition"];
    from: string;
    to: string;
    matchIds: string[];
  }[] = [];
  const dayNumber = (date: number) => Math.floor(date / (24 * HOUR));
  for (const code of COMPETITION_CODES) {
    const sorted = matches
      .filter((m) => m.competition === code)
      .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate));
    let current: (typeof windows)[number] | undefined;
    let firstDay = 0;
    for (const match of sorted) {
      const date = Date.parse(match.utcDate);
      if (!current || dayNumber(date + 15 * 60_000) - firstDay > 4) {
        firstDay = dayNumber(date - 15 * 60_000);
        current = {
          competition: code,
          from: apiDate(date - 15 * 60_000),
          to: apiDate(date + 15 * 60_000),
          matchIds: [],
        };
        windows.push(current);
      }
      current.to = apiDate(date + 15 * 60_000);
      current.matchIds.push(match.id);
    }
  }
  return windows;
}
function validPrevious(
  value: Record<string, unknown> | undefined,
  match: Match,
): StoredMatchInsight | null {
  if (
    !value ||
    typeof value.checkedAt !== "string" ||
    !Number.isFinite(Date.parse(value.checkedAt)) ||
    typeof value.kickoff !== "string" ||
    Date.parse(value.kickoff) !== Date.parse(match.utcDate) ||
    typeof value.status !== "string"
  )
    return null;
  const insight =
    validMatchInsight(value.insight) && insightFitsMatch(value.insight, match)
      ? value.insight
      : null;
  return {
    insight,
    checkedAt: value.checkedAt,
    kickoff: value.kickoff,
    status: value.status,
    ...(typeof value.matchupsCheckedAt === "string" &&
    Number.isFinite(Date.parse(value.matchupsCheckedAt))
      ? { matchupsCheckedAt: value.matchupsCheckedAt }
      : {}),
  };
}
function hasInformation(value: MatchInsight | null) {
  return Boolean(
    value &&
    (value.probability ||
      value.incidents?.length ||
      value.matchups?.length ||
      value.venue ||
      value.referee ||
      value.attendance !== undefined ||
      value.goals.length ||
      value.lineups.length ||
      value.statistics.length),
  );
}
const apiDate = (date: number) =>
  new Date(date).toISOString().slice(0, 10).replaceAll("-", "");

// This is deliberately an optional enrichment after official scoring. No calendar,
// match, prediction or standing is ever read or written by this process.
export async function syncMatchInsights(
  db: Firestore,
  matches: Match[],
  options: SyncOptions = {},
) {
  const now = options.now ?? Date.now();
  const client = options.client ?? createEspnClient();
  const log = options.log ?? console.log;
  const history = createMatchupRecovery(client, now);
  const candidates = insightCandidates(matches, now);
  const report = {
    reads: 0,
    scoreboards: 0,
    summaries: 0,
    odds: 0,
    historyRequests: 0,
    missingSummaries: 0,
    failedCompetitions: 0,
    updated: 0,
    skipped: 0,
    stopped: false,
    available: 0,
    unmatched: 0,
    rejectedSummaries: 0,
  };
  if (!candidates.length) return report;
  const snapshots = await db.getAll(
    ...candidates.map((match) => db.doc(`matchInsights/${match.id}`)),
  );
  report.reads = candidates.length;
  const prior = new Map(
    snapshots.map((snapshot) => [snapshot.id, snapshot.data()]),
  );
  report.available = candidates.filter((match) =>
    hasInformation(validPrevious(prior.get(match.id), match)?.insight || null),
  ).length;
  const pending = candidates
    .map((match) => ({
      match,
      previous: validPrevious(prior.get(match.id), match),
    }))
    .filter(({ match, previous }) => {
      const checkedAt = previous ? Date.parse(previous.checkedAt) : 0;
      const interval =
        options.liveRefreshMs !== undefined && isHotMatch(match, now)
          ? options.liveRefreshMs
          : insightRefreshInterval(match, now, previous?.insight);
      const fresh =
        previous &&
        checkedAt <= now &&
        now - checkedAt < interval &&
        previous.status === match.status;
      if (fresh) report.skipped++;
      return !fresh;
    })
    .sort(
      (a, b) =>
        (a.previous ? Date.parse(a.previous.checkedAt) : -Infinity) -
        (b.previous ? Date.parse(b.previous.checkedAt) : -Infinity),
    );
  const emit = (updated: { id: string; data: StoredMatchInsight }[]) => {
    if (!options.onInsight) return;
    const written = new Map(updated.map((u) => [u.id, u.data.insight]));
    for (const match of candidates)
      options.onInsight(
        match.id,
        written.has(match.id)
          ? written.get(match.id)!
          : validPrevious(prior.get(match.id), match)?.insight || null,
      );
  };
  if (!pending.length) {
    emit([]);
    log(
      `Detalles de partidos: ${report.reads} lecturas, caché vigente; 0 consultas a ESPN.`,
    );
    return report;
  }
  const windows = insightCalendarWindows(pending.map((p) => p.match));
  const windowForMatch = new Map(
    windows.flatMap((window) =>
      window.matchIds.map((id) => [id, window] as const),
    ),
  );
  const listings = new Map<(typeof windows)[number], EspnEvent[] | null>();
  const updates: { id: string; data: StoredMatchInsight }[] = [];
  try {
    for (const { match, previous } of pending) {
      if (report.summaries >= MAX_SUMMARIES) break;
      let event = options.events?.get(match.id) ?? null;
      if (event && !eventFitsMatch(event, match)) event = null;
      const window = windowForMatch.get(match.id)!;
      // Download only the date window actually needed, not every historical day.
      if (!event && !listings.has(window)) {
        report.scoreboards++;
        try {
          listings.set(
            window,
            await client.scoreboard(window.competition, window.from, window.to),
          );
        } catch (error) {
          if (
            error instanceof EspnRequestError &&
            [400, 404].includes(error.status || 0)
          ) {
            report.failedCompetitions++;
            listings.set(window, null);
            log(
              `ESPN ${window.competition}: calendario no disponible; continúan las otras fechas y competiciones.`,
            );
          } else throw error;
        }
      }
      if (!event) {
        const listing = listings.get(window);
        if (!listing) continue;
        event = findEspnEvent(match, listing);
        if (event) options.events?.set(match.id, event);
      }
      let insight = previous?.insight || null;
      let matchupsCheckedAt = previous?.matchupsCheckedAt;
      if (event) {
        if (report.summaries >= MAX_SUMMARIES) break;
        report.summaries++;
        let summary: unknown;
        try {
          summary = await client.summary(match.competition, event.id);
        } catch (error) {
          if (
            error instanceof EspnRequestError &&
            [400, 404].includes(error.status || 0)
          )
            report.missingSummaries++;
          else throw error;
        }
        let normalized = normalizeEspnSummary(
          summary,
          match,
          event,
          new Date(now).toISOString(),
        );
        if (!normalized) report.rejectedSummaries++;
        // A missing summary may still have a fully matched, real scoreboard event.
        if (
          !normalized &&
          summary === undefined &&
          ["TIMED", "SCHEDULED"].includes(match.status)
        )
          normalized = {
            version: 1,
            matchId: match.id,
            competition: match.competition,
            kickoff: match.utcDate,
            provider: "ESPN",
            eventId: event.id,
            fetchedAt: new Date(now).toISOString(),
            goals: [],
            lineups: [],
            statistics: [],
          };
        if (
          normalized &&
          ["TIMED", "SCHEDULED"].includes(match.status) &&
          Date.parse(match.utcDate) > now
        ) {
          const priorHistory =
            previous?.insight?.eventId === event.id
              ? previous.insight.matchups || []
              : [];
          normalized.matchups = mergeMatchups(
            priorHistory,
            normalized.matchups || [],
          );
          try {
            const recovered = await history.recover(
              match,
              event,
              normalized.matchups,
              previous?.insight && previous.insight.eventId !== event.id
                ? undefined
                : matchupsCheckedAt,
            );
            normalized.matchups = recovered.matches;
            matchupsCheckedAt = recovered.checkedAt;
          } catch (error) {
            report.stopped = true;
            log(
              error instanceof EspnRequestError
                ? error.message
                : "ESPN: historial no disponible; se conserva la ficha.",
            );
          }
          log(
            `ESPN ${match.id}: ${normalized.matchups.length} enfrentamientos reales disponibles.`,
          );
        }
        if (
          normalized &&
          !report.stopped &&
          !normalized.probability &&
          client.odds &&
          report.odds < 8 &&
          ["TIMED", "SCHEDULED"].includes(match.status) &&
          Date.parse(match.utcDate) > now
        ) {
          report.odds++;
          try {
            const response = await client.odds(match.competition, event.id);
            const items =
              response && typeof response === "object"
                ? (response as { items?: unknown }).items
                : undefined;
            const probability = probabilityFromOdds(
              items,
              new Date(now).toISOString(),
            );
            if (probability) normalized.probability = probability;
          } catch (error) {
            if (
              !(error instanceof EspnRequestError) ||
              ![400, 404].includes(error.status || 0)
            ) {
              // Keep the useful summary already downloaded; stop further requests.
              report.stopped = true;
              log(
                error instanceof EspnRequestError
                  ? error.message
                  : "ESPN cuotas: respuesta no utilizable.",
              );
            }
          }
        }
        // Reconcile an official 0–0 even if summary only has a valid header.
        const confirmedNoGoals =
          match.status === "FINISHED" &&
          match.scoreDuration === "REGULAR" &&
          match.homeScore === 0 &&
          match.awayScore === 0;
        const old = previous?.insight;
        if (
          normalized &&
          (hasInformation(normalized) ||
            confirmedNoGoals ||
            (old && old.eventId !== normalized.eventId))
        ) {
          if (old && old.eventId === normalized.eventId) {
            const lineups = new Map(
              old.lineups.map((lineup) => [lineup.side, lineup]),
            );
            const statistics = new Map(
              old.statistics.map((statistic) => [statistic.label, statistic]),
            );
            for (const lineup of normalized.lineups)
              lineups.set(lineup.side, lineup);
            for (const statistic of normalized.statistics)
              statistics.set(statistic.label, statistic);
            // Missing sides/statistics are partial data, not evidence they vanished.
            // Preserve the oldest fetchedAt whenever any previous field is reused.
            const retained =
              (!normalized.matchups?.length && Boolean(old.matchups?.length)) ||
              (!normalized.incidents?.length &&
                Boolean(old.incidents?.length)) ||
              (!confirmedNoGoals &&
                !normalized.goals.length &&
                old.goals.length > 0) ||
              old.lineups.some(
                (lineup) =>
                  !normalized.lineups.some((next) => next.side === lineup.side),
              ) ||
              old.statistics.some(
                (statistic) =>
                  !normalized.statistics.some(
                    (next) => next.label === statistic.label,
                  ),
              ) ||
              (!normalized.venue && Boolean(old.venue)) ||
              (!normalized.referee && Boolean(old.referee)) ||
              (normalized.attendance === undefined &&
                old.attendance !== undefined);
            const { probability: _previousProbability, ...oldDetails } = old;
            insight = {
              ...oldDetails,
              ...normalized,
              goals: confirmedNoGoals
                ? []
                : normalized.goals.length
                  ? normalized.goals
                  : old.goals,
              incidents: normalized.incidents?.length
                ? normalized.incidents
                : old.incidents || [],
              matchups: normalized.matchups?.length
                ? normalized.matchups
                : old.matchups || [],
              lineups: [...lineups.values()],
              statistics: [...statistics.values()],
              fetchedAt: retained ? old.fetchedAt : normalized.fetchedAt,
            };
          } else
            insight = confirmedNoGoals
              ? { ...normalized, goals: [] }
              : normalized;
        }
      } else {
        report.unmatched++;
      }
      updates.push({
        id: match.id,
        data: {
          insight,
          ...(matchupsCheckedAt ? { matchupsCheckedAt } : {}),
          checkedAt: new Date(now).toISOString(),
          kickoff: match.utcDate,
          status: match.status,
        },
      });
      if (report.stopped) break;
    }
  } catch (error) {
    report.stopped = true;
    // No response body, URL query, credential or uncontrolled provider text in logs.
    log(
      error instanceof EspnRequestError
        ? error.message
        : "ESPN: respuesta no utilizable; se conserva la información anterior.",
    );
  }
  if (updates.length) {
    const batch = db.batch();
    for (const update of updates)
      batch.set(db.doc(`matchInsights/${update.id}`), update.data);
    await batch.commit();
    report.updated = updates.length;
    for (const update of updates) {
      const match = candidates.find((candidate) => candidate.id === update.id)!;
      if (
        hasInformation(
          validPrevious(prior.get(update.id), match)?.insight || null,
        )
      )
        report.available--;
      if (hasInformation(update.data.insight)) report.available++;
    }
  }
  emit(updates);
  report.historyRequests = history.requests;
  log(
    `Detalles de partidos: ${report.reads} lecturas, ${report.historyRequests} consultas de historial, ${report.scoreboards} calendarios ESPN, ${report.summaries} fichas, ${report.odds} consultas de cuotas, ${report.missingSummaries} fichas no disponibles, ${report.failedCompetitions} calendarios fallidos, ${report.updated} documentos actualizados, ${report.available} fichas con información, ${report.unmatched} sin asociación y ${report.rejectedSummaries} respuestas rechazadas${report.stopped ? "; proveedor interrumpido" : ""}.`,
  );
  return report;
}
