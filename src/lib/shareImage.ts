import { competitionName } from "./competitions";
import { predictionSummary } from "./domain";
import { pickState, roundBoard, type PickState } from "./roundBoard";
import {
  matchScoreLabel,
  type QuinielaShare,
  type StandingsShare,
} from "./shareSummary";

/*
 * Local PNGs drawn with Canvas in the «Boleto» style: paper, ink masthead and
 * one yellow highlighter. No remote crests; the fonts are the app's own
 * (same origin), so the canvas is never tainted and works offline.
 */
const WIDTH = 1080;
const PAD = 56;
const MAST = 196;
const colors = {
  paper: "#f2efe6",
  card: "#fbfaf5",
  row: "#e8e4d8",
  rule: "#d5d0c1",
  ink: "#15140f",
  ink2: "#48453d",
  muted: "#645f56",
  mastInk: "#f2efe6",
  mastMuted: "#a8a396",
  accent: "#ffd100",
  hit: "#1d7a45",
  hitSoft: "#d5e6d9",
  miss: "#c0352a",
  missSoft: "#f2d9d4",
  live: "#d4231a",
};
type Ctx = CanvasRenderingContext2D;
type Face = "display" | "text";

const DISPLAY = '"Anybody Variable", "Arial Narrow", sans-serif';
const TEXT = '"Instrument Sans Variable", "Helvetica Neue", Arial, sans-serif';

/** Waits for the app fonts; falls back silently to system fonts. */
export async function loadShareFonts() {
  try {
    await Promise.all([
      document.fonts.load(`800 48px ${DISPLAY}`),
      document.fonts.load(`600 20px ${TEXT}`),
    ]);
  } catch {
    /* System fonts are fine. */
  }
}

function setFont(ctx: Ctx, size: number, weight = 500, face: Face = "text") {
  ctx.font = `${weight} ${size}px ${face === "display" ? DISPLAY : TEXT}`;
  // Anybody is width-variable: condensed for titles and numbers where supported.
  if ("fontStretch" in ctx)
    ctx.fontStretch = face === "display" ? "condensed" : "normal";
}
function fit(ctx: Ctx, value: string, maxWidth: number) {
  if (ctx.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth)
    text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}
function write(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  color = colors.ink,
  weight = 500,
  align: CanvasTextAlign = "left",
  maxWidth = Infinity,
  face: Face = "text",
) {
  setFont(ctx, size, weight, face);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(fit(ctx, value, maxWidth), x, y);
}
/** Wide uppercase label, like the slip's printed captions. */
function label(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  color = colors.muted,
  align: CanvasTextAlign = "left",
  maxWidth = Infinity,
) {
  setFont(ctx, 15, 750, "display");
  if ("fontStretch" in ctx) ctx.fontStretch = "expanded";
  if ("letterSpacing" in ctx)
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = "1.5px";
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(fit(ctx, value.toUpperCase(), maxWidth), x, y);
  if ("letterSpacing" in ctx)
    (ctx as Ctx & { letterSpacing: string }).letterSpacing = "0px";
}
function box(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  radius = 10,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = color;
  ctx.fill();
}
function rule(ctx: Ctx, y: number, color = colors.rule, height = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(PAD, y, WIDTH - PAD * 2, height);
}
/** Yellow marker stroke behind a number. */
function highlight(ctx: Ctx, x: number, y: number, w: number, h = 14) {
  ctx.fillStyle = colors.accent;
  ctx.fillRect(x, y, w, h);
}
function canvasFor(height: number) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no ha podido preparar la imagen.");
  canvas.width = WIDTH;
  canvas.height = height;
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = "middle";
  return { canvas, ctx };
}
/** The brand: a yellow tile with a marked box. */
function brandMark(ctx: Ctx, x: number, y: number, size: number) {
  box(ctx, x, y, size, size, colors.accent, size * 0.23);
  const s = size / 64;
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 5 * s;
  ctx.beginPath();
  ctx.roundRect(x + 15 * s, y + 15 * s, 34 * s, 34 * s, 5 * s);
  ctx.stroke();
  ctx.lineWidth = 6.6 * s;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + 24 * s, y + 25 * s);
  ctx.lineTo(x + 40 * s, y + 39.5 * s);
  ctx.moveTo(x + 39 * s, y + 24 * s);
  ctx.lineTo(x + 25 * s, y + 40.5 * s);
  ctx.stroke();
}
function header(ctx: Ctx, kicker: string, title: string, subtitle: string) {
  ctx.fillStyle = colors.ink;
  ctx.fillRect(0, 0, WIDTH, MAST + 24);
  brandMark(ctx, PAD, 34, 40);
  label(ctx, kicker, PAD + 54, 55, colors.accent, "left", WIDTH - PAD * 2 - 54);
  write(
    ctx,
    title,
    PAD,
    112,
    58,
    colors.mastInk,
    850,
    "left",
    WIDTH - PAD * 2,
    "display",
  );
  write(
    ctx,
    subtitle,
    PAD,
    160,
    22,
    colors.mastMuted,
    550,
    "left",
    WIDTH - PAD * 2,
  );
  // The sheet of paper laid over the ink.
  box(ctx, 0, MAST, WIDTH, 48, colors.paper, 26);
}
function footer(ctx: Ctx, y: number, note: string) {
  rule(ctx, y - 18, colors.ink, 3);
  write(ctx, note, PAD, y + 8, 17, colors.muted, 500, "left", WIDTH - PAD * 2);
  const date = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  write(
    ctx,
    `galacticbet · ${date}`,
    WIDTH - PAD,
    y + 40,
    17,
    colors.ink2,
    650,
    "right",
  );
}
function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen.")),
      "image/png",
    ),
  );
}
const pickColors: Record<Exclude<PickState, null>, [string, string]> = {
  hit: [colors.hitSoft, colors.hit],
  "live-hit": [colors.hitSoft, colors.hit],
  miss: [colors.missSoft, colors.miss],
  "live-miss": [colors.row, colors.muted],
};

/** All shared picks of the round, one column per player, plus round points. */
export async function quinielaImage(q: QuinielaShare): Promise<Blob> {
  await loadShareFonts();
  const perBlock = 6;
  const blocks = Math.max(1, Math.ceil(q.players.length / perBlock));
  const rowH = 76;
  const headH = 58;
  const blockH = headH + q.matches.length * rowH + 66;
  const board = roundBoard(q.matches, q.mode, q.players);
  const scored = board.some((r) => r.points || r.livePoints);
  const boardH = scored ? 70 + board.length * 46 : 0;
  const height = 230 + blocks * (blockH + 28) + boardH + 120;
  const { canvas, ctx } = canvasFor(height);
  const competition = q.matches[0]
    ? competitionName(q.matches[0].competition)
    : "";
  header(
    ctx,
    `Quiniela${q.demo ? " · demo" : ""}`,
    q.groupName,
    `${q.title}${competition && !q.title.includes(competition) ? ` · ${competition}` : ""} · ${q.mode === "classic" ? "1X2" : "Marcador exacto"}`,
  );
  const matchW = 420;
  let y = 236;
  for (let b = 0; b < blocks; b++) {
    const people = q.players.slice(b * perBlock, (b + 1) * perBlock);
    const colW = (WIDTH - PAD * 2 - matchW - 8) / Math.max(people.length, 1);
    rule(ctx, y, colors.ink, 3);
    label(ctx, "Partido", PAD, y + headH / 2 + 2);
    people.forEach((p, i) =>
      write(
        ctx,
        p.name,
        PAD + matchW + 8 + colW * i + colW / 2,
        y + headH / 2 + 2,
        19,
        colors.ink,
        700,
        "center",
        colW - 10,
      ),
    );
    let rowY = y + headH;
    q.matches.forEach((m, index) => {
      rule(ctx, rowY);
      const scoreText = matchScoreLabel(m).replace(" (en juego)", "");
      const live = ["IN_PLAY", "PAUSED"].includes(m.status);
      write(
        ctx,
        String(index + 1).padStart(2, "0"),
        PAD,
        rowY + rowH / 2,
        22,
        colors.muted,
        800,
        "left",
        Infinity,
        "display",
      );
      write(ctx, m.home, PAD + 44, rowY + 24, 20, colors.ink, 650, "left", matchW - 140);
      write(ctx, m.away, PAD + 44, rowY + 52, 20, colors.ink, 650, "left", matchW - 140);
      write(
        ctx,
        scoreText,
        PAD + matchW - 14,
        rowY + 32,
        scoreText === "vs" ? 18 : 30,
        live ? colors.live : scoreText === "vs" ? colors.muted : colors.ink,
        900,
        "right",
        Infinity,
        "display",
      );
      if (live) label(ctx, "En juego", PAD + matchW - 14, rowY + 58, colors.live, "right");
      people.forEach((p, i) => {
        const value = p.picks[m.id];
        const state = pickState(q.mode, value, m);
        const [fill, ink] = state ? pickColors[state] : [colors.row, colors.ink];
        const cx = PAD + matchW + 8 + colW * i;
        box(ctx, cx + 6, rowY + 12, colW - 12, rowH - 24, fill, 8);
        write(
          ctx,
          value ? predictionSummary(value).replace(" – ", "-") : "—",
          cx + colW / 2,
          rowY + rowH / 2 + 1,
          value ? 28 : 20,
          value ? ink : colors.muted,
          900,
          "center",
          colW - 18,
          "display",
        );
      });
      rowY += rowH;
    });
    rule(ctx, rowY, colors.ink, 2);
    label(ctx, "Puntos jornada", PAD, rowY + 34);
    people.forEach((p, i) => {
      const row = board.find((r) => r.id === p.id);
      const text = row
        ? `${row.points}${row.livePoints ? ` (+${row.livePoints})` : ""}`
        : "0";
      const cx = PAD + matchW + 8 + colW * i + colW / 2;
      setFont(ctx, 28, 900, "display");
      const w = Math.min(colW - 16, ctx.measureText(text).width + 12);
      highlight(ctx, cx - w / 2, rowY + 38, w, 12);
      write(ctx, text, cx, rowY + 34, 28, colors.ink, 900, "center", colW - 10, "display");
    });
    y += blockH + 28;
  }
  if (scored) {
    write(ctx, "Así va la jornada", PAD, y + 22, 34, colors.ink, 850, "left", Infinity, "display");
    y += 62;
    for (const r of board) {
      rule(ctx, y);
      if (r.position === 1) box(ctx, PAD, y + 7, 34, 32, colors.accent, 6);
      write(
        ctx,
        String(r.position),
        PAD + 17,
        y + 23,
        24,
        r.position === 1 ? colors.ink : colors.muted,
        900,
        "center",
        Infinity,
        "display",
      );
      write(ctx, r.name, PAD + 52, y + 23, 20, colors.ink, 650, "left", 600);
      write(
        ctx,
        `${r.points} pts${r.livePoints ? ` · +${r.livePoints} en juego` : ""}`,
        WIDTH - PAD,
        y + 23,
        24,
        colors.ink,
        900,
        "right",
        Infinity,
        "display",
      );
      y += 46;
    }
    rule(ctx, y);
    y += 8;
  }
  footer(
    ctx,
    y + 44,
    "Verde: acierto · Rojo: fallo · Resultados a 90 min. Puntos provisionales hasta cerrar la jornada.",
  );
  return toPng(canvas);
}

export async function standingsImage(s: StandingsShare): Promise<Blob> {
  await loadShareFonts();
  const rowH = 64;
  const height = 236 + 50 + s.rows.length * (rowH + 8) + 120;
  const { canvas, ctx } = canvasFor(height);
  header(ctx, `Clasificación${s.demo ? " · demo" : ""}`, s.groupName, s.title);
  let y = 240;
  rule(ctx, y, colors.ink, 3);
  label(ctx, "Pos.", PAD + 22, y + 22, colors.muted, "center");
  label(ctx, "Jugador", PAD + 70, y + 22);
  if (s.showHits) label(ctx, "Aciertos", WIDTH - PAD - 150, y + 22, colors.muted, "right");
  label(ctx, "Puntos", WIDTH - PAD, y + 22, colors.muted, "right");
  y += 46;
  const leader = s.rows[0]?.points || 0;
  for (const r of s.rows) {
    rule(ctx, y);
    if (leader > 0)
      highlight(ctx, PAD, y + rowH + 2, ((WIDTH - PAD * 2) * r.points) / leader, 4);
    const podium = r.points > 0 && r.position <= 3;
    if (podium)
      box(ctx, PAD + 3, y + rowH / 2 - 19, 38, 38, r.position === 1 ? colors.accent : colors.ink, 8);
    write(
      ctx,
      String(r.position),
      PAD + 22,
      y + rowH / 2 + 1,
      26,
      podium ? (r.position === 1 ? colors.ink : colors.paper) : colors.muted,
      900,
      "center",
      Infinity,
      "display",
    );
    write(
      ctx,
      r.name,
      PAD + 70,
      y + rowH / 2,
      24,
      colors.ink,
      700,
      "left",
      s.showHits ? 620 : 740,
    );
    if (s.showHits)
      write(ctx, String(r.hits), WIDTH - PAD - 150, y + rowH / 2, 24, colors.ink2, 800, "right", Infinity, "display");
    write(
      ctx,
      String(r.points),
      WIDTH - PAD,
      y + rowH / 2 + 1,
      38,
      colors.ink,
      900,
      "right",
      Infinity,
      "display",
    );
    y += rowH + 8;
  }
  rule(ctx, y);
  footer(
    ctx,
    y + 48,
    "Puntos calculados por el servidor con resultados a 90 minutos.",
  );
  return toPng(canvas);
}
