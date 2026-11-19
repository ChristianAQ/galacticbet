import { competitionName } from "./competitions";
import { predictionSummary } from "./domain";
import { pickState, roundBoard, type PickState } from "./roundBoard";
import {
  matchScoreLabel,
  type QuinielaShare,
  type StandingsShare,
} from "./shareSummary";

/*
 * Local PNGs drawn with Canvas: no remote crests or fonts, so the canvas is never
 * tainted and the image works offline and in every share target.
 */
const WIDTH = 1080;
const PAD = 48;
const colors = {
  background: "#111317",
  panel: "#191c21",
  row: "#1f2329",
  border: "#2e333b",
  text: "#eeeff2",
  muted: "#9ca3ad",
  accent: "#c5f66a",
  hit: "#8cdb63",
  miss: "#ef7772",
  gold: "#f0d58c",
};
type Ctx = CanvasRenderingContext2D;

function setFont(ctx: Ctx, size: number, weight = 500) {
  ctx.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
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
  color = colors.text,
  weight = 500,
  align: CanvasTextAlign = "left",
  maxWidth = Infinity,
) {
  setFont(ctx, size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(fit(ctx, value, maxWidth), x, y);
}
function box(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  radius = 14,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fillStyle = color;
  ctx.fill();
}
function canvasFor(height: number) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no ha podido preparar la imagen.");
  canvas.width = WIDTH;
  canvas.height = height;
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = "middle";
  return { canvas, ctx };
}
function header(ctx: Ctx, kicker: string, title: string, subtitle: string) {
  write(ctx, kicker, PAD, 58, 20, colors.accent, 750);
  write(ctx, title, PAD, 108, 44, colors.text, 800, "left", WIDTH - PAD * 2);
  write(
    ctx,
    subtitle,
    PAD,
    158,
    22,
    colors.muted,
    550,
    "left",
    WIDTH - PAD * 2,
  );
}
function footer(ctx: Ctx, y: number, note: string) {
  write(ctx, note, PAD, y, 17, colors.muted, 500, "left", WIDTH - PAD * 2);
  const date = new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
  write(
    ctx,
    `GalacticBet · ${date}`,
    WIDTH - PAD,
    y + 30,
    17,
    colors.muted,
    600,
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
  hit: ["#24361f", colors.hit],
  "live-hit": ["#1f2a1f", colors.hit],
  miss: ["#3a2224", colors.miss],
  "live-miss": [colors.row, colors.muted],
};

/** All shared picks of the round, one column per player, plus round points. */
export async function quinielaImage(q: QuinielaShare): Promise<Blob> {
  const perBlock = 6;
  const blocks = Math.max(1, Math.ceil(q.players.length / perBlock));
  const rowH = 76;
  const headH = 58;
  const blockH = headH + q.matches.length * rowH + 66;
  const board = roundBoard(q.matches, q.mode, q.players);
  const scored = board.some((r) => r.points || r.livePoints);
  const boardH = scored ? 70 + board.length * 46 : 0;
  const height = 210 + blocks * (blockH + 28) + boardH + 110;
  const { canvas, ctx } = canvasFor(height);
  const competition = q.matches[0]
    ? competitionName(q.matches[0].competition)
    : "";
  header(
    ctx,
    `GALACTICBET · QUINIELA${q.demo ? " · DEMO" : ""}`,
    q.groupName,
    `${q.title}${competition && !q.title.includes(competition) ? ` · ${competition}` : ""} · ${q.mode === "classic" ? "1X2" : "Marcador exacto"}`,
  );
  const matchW = 400;
  let y = 210;
  for (let b = 0; b < blocks; b++) {
    const people = q.players.slice(b * perBlock, (b + 1) * perBlock);
    const colW = (WIDTH - PAD * 2 - matchW - 16) / Math.max(people.length, 1);
    box(ctx, PAD - 12, y, WIDTH - PAD * 2 + 24, blockH, colors.panel, 20);
    write(ctx, "Partido", PAD + 8, y + headH / 2 + 4, 17, colors.muted, 650);
    people.forEach((p, i) =>
      write(
        ctx,
        p.name,
        PAD + matchW + 16 + colW * i + colW / 2,
        y + headH / 2 + 4,
        18,
        colors.text,
        700,
        "center",
        colW - 10,
      ),
    );
    let rowY = y + headH;
    for (const m of q.matches) {
      ctx.fillStyle = colors.border;
      ctx.fillRect(PAD, rowY, WIDTH - PAD * 2, 1);
      const scoreText = matchScoreLabel(m).replace(" (en juego)", "");
      const live = ["IN_PLAY", "PAUSED"].includes(m.status);
      write(
        ctx,
        m.home,
        PAD + 8,
        rowY + 24,
        20,
        colors.text,
        650,
        "left",
        matchW - 96,
      );
      write(
        ctx,
        m.away,
        PAD + 8,
        rowY + 52,
        20,
        colors.text,
        650,
        "left",
        matchW - 96,
      );
      write(
        ctx,
        scoreText,
        PAD + matchW - 12,
        rowY + 30,
        scoreText === "vs" ? 18 : 24,
        live ? colors.hit : scoreText === "vs" ? colors.muted : colors.text,
        800,
        "right",
      );
      if (live)
        write(
          ctx,
          "EN JUEGO",
          PAD + matchW - 12,
          rowY + 56,
          12,
          colors.hit,
          750,
          "right",
        );
      people.forEach((p, i) => {
        const value = p.picks[m.id];
        const state = pickState(q.mode, value, m);
        const [fill, ink] = state
          ? pickColors[state]
          : [colors.row, colors.text];
        const cx = PAD + matchW + 16 + colW * i;
        box(ctx, cx + 6, rowY + 12, colW - 12, rowH - 24, fill, 10);
        write(
          ctx,
          value ? predictionSummary(value).replace(" – ", "-") : "—",
          cx + colW / 2,
          rowY + rowH / 2,
          value ? 24 : 20,
          value ? ink : colors.muted,
          800,
          "center",
          colW - 18,
        );
      });
      rowY += rowH;
    }
    ctx.fillStyle = colors.border;
    ctx.fillRect(PAD, rowY, WIDTH - PAD * 2, 1);
    write(ctx, "Puntos jornada", PAD + 8, rowY + 34, 18, colors.muted, 700);
    people.forEach((p, i) => {
      const row = board.find((r) => r.id === p.id);
      write(
        ctx,
        row
          ? `${row.points}${row.livePoints ? ` (+${row.livePoints})` : ""}`
          : "0",
        PAD + matchW + 16 + colW * i + colW / 2,
        rowY + 34,
        22,
        colors.accent,
        800,
        "center",
        colW - 10,
      );
    });
    y += blockH + 28;
  }
  if (scored) {
    write(
      ctx,
      "Clasificación de la jornada",
      PAD,
      y + 22,
      24,
      colors.text,
      800,
    );
    y += 62;
    for (const r of board) {
      box(ctx, PAD - 12, y, WIDTH - PAD * 2 + 24, 40, colors.panel, 10);
      write(
        ctx,
        String(r.position),
        PAD + 14,
        y + 20,
        19,
        r.position === 1 ? colors.gold : colors.muted,
        800,
        "center",
      );
      write(ctx, r.name, PAD + 44, y + 20, 19, colors.text, 650, "left", 600);
      write(
        ctx,
        `${r.points} pts${r.livePoints ? ` · +${r.livePoints} en juego` : ""}`,
        WIDTH - PAD,
        y + 20,
        19,
        colors.accent,
        800,
        "right",
      );
      y += 46;
    }
    y += 8;
  }
  footer(
    ctx,
    y + 26,
    "Verde: acierto · Rojo: fallo · Resultados a 90 min. Puntos provisionales hasta cerrar la jornada.",
  );
  return toPng(canvas);
}

export async function standingsImage(s: StandingsShare): Promise<Blob> {
  const rowH = 64;
  const height = 210 + 50 + s.rows.length * (rowH + 8) + 110;
  const { canvas, ctx } = canvasFor(height);
  header(
    ctx,
    `GALACTICBET · CLASIFICACIÓN${s.demo ? " · DEMO" : ""}`,
    s.groupName,
    s.title,
  );
  let y = 214;
  write(ctx, "Pos.", PAD + 22, y + 14, 16, colors.muted, 650, "center");
  write(ctx, "Jugador", PAD + 70, y + 14, 16, colors.muted, 650);
  if (s.showHits)
    write(
      ctx,
      "Aciertos",
      WIDTH - PAD - 150,
      y + 14,
      16,
      colors.muted,
      650,
      "right",
    );
  write(
    ctx,
    "Puntos",
    WIDTH - PAD - 16,
    y + 14,
    16,
    colors.muted,
    650,
    "right",
  );
  y += 40;
  const leader = s.rows[0]?.points || 0;
  const medals = [colors.gold, "#cfd6df", "#d9a066"];
  for (const r of s.rows) {
    box(ctx, PAD - 12, y, WIDTH - PAD * 2 + 24, rowH, colors.panel, 14);
    if (leader > 0) {
      box(
        ctx,
        PAD - 12,
        y + rowH - 5,
        ((WIDTH - PAD * 2 + 24) * r.points) / leader,
        5,
        "#c5f66a33",
        3,
      );
    }
    const medal =
      r.points > 0 && r.position <= 3 ? medals[r.position - 1] : null;
    if (medal) {
      ctx.beginPath();
      ctx.arc(PAD + 22, y + rowH / 2, 19, 0, Math.PI * 2);
      ctx.fillStyle = medal;
      ctx.fill();
    }
    write(
      ctx,
      String(r.position),
      PAD + 22,
      y + rowH / 2,
      20,
      medal ? "#16181c" : colors.muted,
      800,
      "center",
    );
    write(
      ctx,
      r.name,
      PAD + 70,
      y + rowH / 2,
      23,
      colors.text,
      700,
      "left",
      s.showHits ? 640 : 760,
    );
    if (s.showHits)
      write(
        ctx,
        String(r.hits),
        WIDTH - PAD - 150,
        y + rowH / 2,
        22,
        colors.muted,
        650,
        "right",
      );
    write(
      ctx,
      String(r.points),
      WIDTH - PAD - 16,
      y + rowH / 2,
      28,
      colors.accent,
      800,
      "right",
    );
    y += rowH + 8;
  }
  footer(
    ctx,
    y + 30,
    "Puntos calculados por el servidor con resultados a 90 minutos.",
  );
  return toPng(canvas);
}
