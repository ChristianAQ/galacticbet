import { randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { COMPETITION_CODES } from "../src/lib/competitions";
import { decodeCalendar } from "../src/lib/calendar";
import type { Match } from "../src/lib/domain";
import {
  LIVE_FORMAT,
  inLiveWindow,
  isHotMatch,
  liveEvents,
  type LiveMatch,
} from "../src/lib/liveBoard";
import type { MatchInsight } from "../src/lib/matchInsightsData";
import { createEspnClient, type EspnClient, type EspnEvent } from "./espn";
import { SYNC_STATUS_DOC } from "./officialSync";
import { syncMatchInsights } from "./syncMatchInsights";
import { syncSportApi } from "./syncSportApi";

export const LIVE_DOC = "live/football";
const MINUTE = 60_000;
/** SportAPI cadence: one date request per minute only while a fixture is in play. */
const HOT_GAP = MINUTE;
const IDLE_GAP = 10 * MINUTE;
/**
 * ESPN summaries (goals, cards and who) for fixtures in play: a pass every
 * minute, but each match is read again only after a goal (SportAPI's score
 * changed), when its state changes (half-time, full time) or every three
 * minutes: the scorer arrives about a minute after the score, and a night of
 * nine Champions matches stays at about three requests a minute.
 */
const ESPN_GAP = MINUTE;
const ESPN_MATCH_REFRESH = 3 * MINUTE;
/**
 * A match that ends while followed is read at the whistle and again this
 * long after: ESPN completes its report (statistics, line-ups) in the minutes
 * after the end. The job waits for that read, up to a while longer.
 */
const FINAL_READ_AFTER = 10 * MINUTE;
const FINAL_READ_GIVE_UP = 30 * MINUTE;
/**
 * A provider that fails is tried again after a pause that doubles up to the
 * cap, never dropped for the rest of a long job: only a refused key is.
 */
const RETRY_FIRST = MINUTE;
const RETRY_CAP = 15 * MINUTE;
/** Calendar reads or writes failing this many passes in a row end the job. */
const MAX_FAILED_PASSES = 3;

function retries() {
  let pause = 0;
  let until = -Infinity;
  return {
    ready: (now: number) => now >= until,
    /** The next pause, at least `min`. */
    fail(now: number, min = RETRY_FIRST) {
      pause = Math.min(RETRY_CAP, Math.max(min, pause * 2));
      until = now + pause;
      return pause;
    },
    ok() {
      pause = 0;
      until = -Infinity;
    },
  };
}
/** Football-Data confirms official results; scheduled full syncs may be queued behind us. */
const OFFICIAL_HOT_GAP = 30 * MINUTE;
const OFFICIAL_IDLE_GAP = 2 * 60 * MINUTE;
/** Re-anchor the displayed minute even when nothing else changes. */
const MINUTE_RESYNC = 5 * MINUTE;
const UPCOMING = 20 * MINUTE;

interface LiveLoopOptions {
  sportApiKey?: string;
  /** Total job time. Zero keeps the historical single pass. */
  durationMs?: number;
  verify?: boolean;
  espn?: boolean;
  officialSync?: () => Promise<unknown>;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
  espnClient?: () => EspnClient;
  runId?: string;
  /** Called once per pass (after the board is written), e.g. for the round reminders. */
  onPass?: (now: number) => Promise<unknown>;
}

export async function readCalendars(db: Firestore, now: number) {
  const seasonYear =
    new Date(now).getUTCFullYear() - (new Date(now).getUTCMonth() < 6 ? 1 : 0);
  const snapshots = await db.getAll(
    ...COMPETITION_CODES.map((c) => db.doc(`calendars/${c}-${seasonYear}`)),
  );
  return snapshots.flatMap((s) => (s.exists ? decodeCalendar(s.data()!) : []));
}

// Public board: published calendar state plus display-only minute and events.
export function buildLiveBoard(
  matches: Match[],
  now: number,
  minutes: Map<string, { minute: string; at: number }>,
  insights: Map<string, MatchInsight | null>,
): LiveMatch[] {
  return matches
    .filter((m) => inLiveWindow(m, now))
    .sort(
      (a, b) =>
        Date.parse(a.utcDate) - Date.parse(b.utcDate) ||
        a.id.localeCompare(b.id),
    )
    .map((m) => {
      const minute = m.status === "IN_PLAY" ? minutes.get(m.id) : undefined;
      return {
        id: m.id,
        status: m.status,
        homeScore: m.homeScore,
        awayScore: m.awayScore,
        winner: m.winner ?? null,
        ...(m.resultProvider ? { provider: m.resultProvider } : {}),
        ...(minute ? { minute: minute.minute, minuteAt: minute.at } : {}),
        events: liveEvents(insights.get(m.id) ?? null),
      };
    });
}

const signature = (matches: LiveMatch[], scoredAt?: number) =>
  JSON.stringify([
    scoredAt ?? null,
    matches.map(({ minuteAt: _anchor, ...rest }) => rest),
  ]);

/**
 * Keeps one GitHub Actions job polling while fixtures are in play. Outside match
 * windows it behaves like the previous ten-minute task: three calendar reads, no
 * provider calls and no writes.
 */
export async function runLiveLoop(db: Firestore, options: LiveLoopOptions) {
  const clock = options.clock ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = options.log ?? console.log;
  const key = options.sportApiKey?.trim() || "";
  const start = clock();
  const deadline = start + (options.durationMs ?? 0);
  const runBase =
    options.runId ??
    `live-${process.env.GITHUB_RUN_ID || randomUUID()}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const minutes = new Map<string, { minute: string; at: number }>();
  const insights = new Map<string, MatchInsight | null>();
  const espnEvents = new Map<string, EspnEvent>();
  let sportApiStopped = !key;
  let sportApiFailed = false;
  const sportApiRetry = retries();
  const espnEnabled = options.espn !== false;
  const espnRetry = retries();
  // Matches seen in play by this job, when each ended, and its two reports after it.
  const playing = new Set<string>();
  const ended = new Map<string, number>();
  const whistleRead = new Set<string>();
  const finalRead = new Set<string>();
  let failedPasses = 0;
  let lastSportApi = -Infinity;
  let lastEspn = -Infinity;
  let lastOfficial: number | undefined;
  let stored: { signature: string; writtenAt: number } | undefined;
  let scoredAt: number | undefined;
  let iterations = 0;
  let requests = 0;
  let writes = 0;
  for (;;) {
    const now = clock();
    let matches: Match[];
    try {
      if (!sportApiStopped && sportApiRetry.ready(now)) {
        const result = await syncSportApi(db, key, {
          now,
          runId: `${runBase}-${iterations}`,
          verify: options.verify && iterations === 0,
          log,
          throttle: {
            lastRequestAt: lastSportApi,
            hotGapMs: HOT_GAP,
            idleGapMs: IDLE_GAP,
          },
        });
        matches = result.matches;
        requests += result.requests;
        if (result.requests) lastSportApi = now;
        for (const [id, minute] of result.minutes)
          minutes.set(id, { minute, at: now });
        if (result.scored) scoredAt = now;
        if (result.stopped) {
          sportApiFailed = true;
          if (result.failure === 401 || result.failure === 403) {
            sportApiStopped = true;
            log("Directo: SportAPI rechaza la clave o el plan; los marcadores siguen con Football-Data.");
          } else {
            // A timeout or a provider error: try again soon (a rate limit, later).
            const pause = sportApiRetry.fail(now, result.failure === 429 ? RETRY_CAP : RETRY_FIRST);
            log(`Directo: SportAPI no responde; se vuelve a probar en ${pause / MINUTE} min.`);
          }
        } else if (result.requests) sportApiRetry.ok();
      } else matches = await readCalendars(db, now);
      failedPasses = 0;
    } catch (error) {
      log(
        `Directo: no se pudo leer o publicar el calendario (${error instanceof Error ? error.message : "error"}); se conservan los datos.`,
      );
      sportApiFailed = true;
      // A blip of Firestore does not end a match day: the next pass tries again.
      if (++failedPasses >= MAX_FAILED_PASSES || clock() + MINUTE > deadline) break;
      await sleep(MINUTE);
      continue;
    }
    iterations++;
    const window = matches.filter((m) => inLiveWindow(m, now));
    const hot = matches.some((m) => isHotMatch(m, now));
    for (const m of window)
      if (["IN_PLAY", "PAUSED"].includes(m.status)) playing.add(m.id);
      else if (m.status === "FINISHED" && playing.has(m.id) && !ended.has(m.id)) ended.set(m.id, now);
    // The final whistle's report at once, and the complete one a few minutes later.
    const whistleDue = [...ended.keys()].filter((id) => !whistleRead.has(id));
    const finalDue = [...ended]
      .filter(([id, at]) => !finalRead.has(id) && now - at >= FINAL_READ_AFTER && now - at < FINAL_READ_GIVE_UP)
      .map(([id]) => id);
    // Still waiting for a complete report after a final whistle (checked again once ESPN has been read).
    const settling = () =>
      espnEnabled && [...ended].some(([id, at]) => !finalRead.has(id) && now - at < FINAL_READ_GIVE_UP);
    const soon = matches.some((m) => {
      const kickoff = Date.parse(m.utcDate);
      return (
        kickoff > now &&
        kickoff - now <= UPCOMING &&
        ["TIMED", "SCHEDULED"].includes(m.status)
      );
    });
    if (window.length || stored) {
      // Lazy reads: idle jobs keep the historical three calendar reads only.
      if (!stored) {
        const [board, status] = await db.getAll(
          db.doc(LIVE_DOC),
          db.doc(SYNC_STATUS_DOC),
        );
        const data = board.data();
        stored = {
          signature:
            data?.formatVersion === LIVE_FORMAT && Array.isArray(data.matches)
              ? signature(data.matches, data.scoredAt)
              : "",
          writtenAt: Number(data?.updatedAt) || 0,
        };
        if (Number.isSafeInteger(data?.scoredAt)) scoredAt ??= data!.scoredAt;
        lastOfficial = Number(status.data()?.fullSyncAt) || 0;
      }
      if (
        options.officialSync &&
        (hot || soon) &&
        now - lastOfficial! >= (hot ? OFFICIAL_HOT_GAP : OFFICIAL_IDLE_GAP)
      ) {
        lastOfficial = now;
        try {
          await options.officialSync();
          log("Directo: resultados oficiales de Football-Data revisados.");
          matches = await readCalendars(db, clock());
        } catch (error) {
          log(
            `Directo: Football-Data no disponible (${error instanceof Error ? error.message : "error"}); continúan los resultados rápidos.`,
          );
        }
      }
      const started = matches.filter(
        (m) => inLiveWindow(m, now) && Date.parse(m.utcDate) <= now,
      );
      if (
        espnEnabled &&
        espnRetry.ready(now) &&
        started.length &&
        (hot || whistleDue.length || finalDue.length || lastEspn === -Infinity) &&
        now - lastEspn >= ESPN_GAP
      ) {
        lastEspn = now;
        let failed = false;
        try {
          const report = await syncMatchInsights(db, started, {
            now,
            client: (options.espnClient ?? createEspnClient)(),
            log,
            liveRefreshMs: ESPN_MATCH_REFRESH - 10_000,
            refresh: new Set([...whistleDue, ...finalDue]),
            events: espnEvents,
            onInsight: (id, insight) => insights.set(id, insight),
          });
          // 403/429 or unusable responses: the scores go on; ESPN after a pause.
          failed = report.stopped;
        } catch {
          failed = true;
        }
        if (failed) {
          const pause = espnRetry.fail(now);
          log(`Directo: eventos ESPN no disponibles; se mantienen los marcadores y se vuelve a probar en ${pause / MINUTE} min.`);
        } else {
          espnRetry.ok();
          for (const id of whistleDue) whistleRead.add(id);
          for (const id of finalDue) finalRead.add(id);
        }
      }
      const board = buildLiveBoard(matches, now, minutes, insights);
      const next = signature(board, scoredAt);
      const inPlay = board.some((m) => m.status === "IN_PLAY");
      if (
        next !== stored.signature ||
        (inPlay && now - stored.writtenAt >= MINUTE_RESYNC)
      ) {
        await db.doc(LIVE_DOC).set({
          formatVersion: LIVE_FORMAT,
          updatedAt: now,
          ...(scoredAt !== undefined ? { scoredAt } : {}),
          matches: board,
        });
        stored = { signature: next, writtenAt: now };
        writes++;
      }
    }
    if (options.onPass)
      await options.onPass(clock()).catch((error) =>
        log(`Directo: tarea periódica fallida (${error instanceof Error ? error.message : "error"}).`),
      );
    const waiting = settling();
    const pause = hot || waiting ? HOT_GAP : 2 * MINUTE;
    if (!(hot || soon || waiting) || clock() + pause > deadline) break;
    await sleep(pause);
  }
  log(
    `Directo: ${iterations} comprobaciones, ${requests} peticiones a SportAPI y ${writes} actualizaciones del marcador en directo.`,
  );
  return { iterations, requests, writes, stopped: sportApiFailed };
}
