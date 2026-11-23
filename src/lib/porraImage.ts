import { euro, porraLeague, porraTotal, type Porra } from "./porra";
import { loadShareFonts } from "./shareImage";

const DISPLAY = '"Anybody Variable", "Arial Narrow", sans-serif';
const TEXT = '"Instrument Sans Variable", "Helvetica Neue", Arial, sans-serif';
const colors = {
  paper: "#f2efe6",
  card: "#fbfaf5",
  rule: "#d5d0c1",
  ink: "#15140f",
  ink2: "#48453d",
  muted: "#645f56",
  mastInk: "#f2efe6",
  mastMuted: "#a8a396",
  accent: "#ffd100",
};

/**
 * The porra as a paper ticket PNG: ink header with punched notches, numbered
 * rows and the total marked in yellow. Local only: no remote assets.
 */
export async function porraImage(p: Porra): Promise<Blob> {
  await loadShareFonts();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Tu navegador no ha podido preparar la imagen.");
  const width = 1000,
    pad = 56,
    header = 100,
    twoColumns = p.players.length > 8,
    columns = twoColumns ? 2 : 1,
    gap = twoColumns ? 36 : 0;
  const colWidth = (width - pad * 2 - gap) / columns;
  type Face = "display" | "text";
  function font(
    size: number,
    weight = 500,
    face: Face = "text",
    stretch: CanvasFontStretch = "condensed",
  ) {
    ctx!.font = `${weight} ${size}px ${face === "display" ? DISPLAY : TEXT}`;
    // Anybody is width-variable; browsers without canvas fontStretch ignore it.
    if ("fontStretch" in ctx!)
      ctx!.fontStretch = face === "display" ? stretch : "normal";
  }
  function lines(value: string, maxWidth: number) {
    const result: string[] = [];
    let current = "";
    for (const char of Array.from(value)) {
      if (current && ctx!.measureText(current + char).width > maxWidth) {
        result.push(current.trim());
        current = char;
      } else current += char;
    }
    if (current) result.push(current.trim());
    return result;
  }
  const playerFont = twoColumns ? 25 : 32;
  const playerLine = twoColumns ? 30 : 38;
  const scoreWidth = twoColumns ? 120 : 160;
  const nameWidth = colWidth - scoreWidth - 64;
  font(playerFont, 600);
  const rowHeights = Array.from(
    { length: Math.ceil(p.players.length / columns) },
    (_, row) =>
      Math.max(
        ...p.players
          .slice(row * columns, row * columns + columns)
          .map((player) =>
            Math.max(
              twoColumns ? 70 : 84,
              lines(player.name, nameWidth).length * playerLine + 26,
            ),
          ),
      ),
  );
  font(50, 850, "display");
  const titleLines = lines(p.title, width - pad * 2);
  font(34, 800, "display");
  const homeLines = lines(p.fixture.home, 380),
    awayLines = lines(p.fixture.away, 380);
  const titleY = header + 74;
  const teamsY = titleY + titleLines.length * 54 + 26;
  const teamsH = Math.max(homeLines.length, awayLines.length) * 40;
  const dateY = teamsY + teamsH + 16;
  const playersY = dateY + 64;
  const rowsH = rowHeights.reduce((sum, size) => sum + size, 0);
  const totalY = playersY + rowsH + 28;
  const height = totalY + 190;
  canvas.width = width;
  canvas.height = height;
  ctx.textBaseline = "top";
  // Paper ticket.
  ctx.fillStyle = colors.card;
  ctx.fillRect(0, 0, width, height);
  function write(
    value: string,
    x: number,
    y: number,
    size: number,
    color = colors.ink,
    weight = 500,
    face: Face = "text",
    align: CanvasTextAlign = "left",
  ) {
    font(size, weight, face);
    ctx!.fillStyle = color;
    ctx!.textAlign = align;
    ctx!.fillText(value, x, y);
  }
  function caption(value: string, x: number, y: number, color = colors.muted, align: CanvasTextAlign = "left") {
    font(15, 750, "display", "expanded");
    if ("letterSpacing" in ctx!)
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "1.5px";
    ctx!.fillStyle = color;
    ctx!.textAlign = align;
    ctx!.fillText(value.toUpperCase(), x, y);
    if ("letterSpacing" in ctx!)
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
  }
  function rule(y: number, x = pad, w = width - pad * 2, color = colors.rule, h = 1) {
    ctx!.fillStyle = color;
    ctx!.fillRect(x, y, w, h);
  }
  // Ink header with the brand.
  ctx.fillStyle = colors.ink;
  ctx.fillRect(0, 0, width, header);
  ctx.beginPath();
  ctx.roundRect(pad, 30, 40, 40, 9);
  ctx.fillStyle = colors.accent;
  ctx.fill();
  ctx.strokeStyle = colors.ink;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.roundRect(pad + 9.4, 39.4, 21.2, 21.2, 3);
  ctx.stroke();
  ctx.lineWidth = 4.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pad + 15, 45.6);
  ctx.lineTo(pad + 25, 54.7);
  ctx.moveTo(pad + 24.4, 45);
  ctx.lineTo(pad + 15.6, 55.3);
  ctx.stroke();
  write("galactic", pad + 54, 32, 32, colors.mastInk, 800, "display");
  font(32, 800, "display");
  const brandWidth = ctx.measureText("galactic").width;
  write("bet", pad + 54 + brandWidth, 32, 32, colors.accent, 900, "display");
  caption(
    p.demo ? "Demo · partido de ejemplo" : "Porra · entre amigos",
    width - pad,
    42,
    colors.mastMuted,
    "right",
  );
  // Punched notches where the stub meets the body.
  ctx.fillStyle = colors.paper;
  for (const x of [0, width]) {
    ctx.beginPath();
    ctx.arc(x, header, 18, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fixture.
  caption(porraLeague(p.fixture), pad, header + 36);
  titleLines.forEach((line, i) =>
    write(line, pad, titleY + i * 54, 50, colors.ink, 850, "display"),
  );
  homeLines.forEach((line, i) =>
    write(line, pad, teamsY + i * 40, 34, colors.ink, 800, "display"),
  );
  awayLines.forEach((line, i) =>
    write(line, width - pad, teamsY + i * 40, 34, colors.ink, 800, "display", "right"),
  );
  caption("vs", width / 2, teamsY + 10, colors.muted, "center");
  write(
    new Intl.DateTimeFormat("es", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(p.fixture.utcDate)),
    pad,
    dateY,
    20,
    colors.ink2,
    500,
  );
  rule(playersY - 22, pad, width - pad * 2, colors.ink, 3);
  // Players: numbered rows like the slip.
  let rowY = playersY;
  p.players.forEach((player, i) => {
    const col = i % columns,
      row = Math.floor(i / columns),
      x = pad + col * (colWidth + gap),
      rowH = rowHeights[row];
    write(
      String(i + 1).padStart(2, "0"),
      x,
      rowY + (rowH - 22) / 2,
      22,
      colors.muted,
      800,
      "display",
    );
    font(playerFont, 600);
    const nameLines = lines(player.name, nameWidth);
    const nameY = rowY + (rowH - nameLines.length * playerLine) / 2;
    nameLines.forEach((line, j) =>
      write(line, x + 46, nameY + j * playerLine + 3, playerFont, colors.ink, 600),
    );
    const scoreSize = twoColumns ? 38 : 48;
    write(
      `${player.home}–${player.away}`,
      x + colWidth,
      rowY + (rowH - scoreSize) / 2 + 2,
      scoreSize,
      colors.ink,
      900,
      "display",
      "right",
    );
    if (col === columns - 1 || i === p.players.length - 1) {
      rowY += rowH;
      if (i < p.players.length - 1) rule(rowY);
    }
  });
  // Perforation, then the total in highlighter.
  ctx.strokeStyle = colors.rule;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 10]);
  ctx.beginPath();
  ctx.moveTo(pad, totalY);
  ctx.lineTo(width - pad, totalY);
  ctx.stroke();
  ctx.setLineDash([]);
  caption("Bote total", pad, totalY + 34, colors.ink);
  write(
    `${p.players.length} personas · ${euro(p.contributionCents)} por persona`,
    pad,
    totalY + 66,
    21,
    colors.muted,
    500,
  );
  const total = euro(porraTotal(p));
  font(76, 900, "display");
  const totalWidth = ctx.measureText(total).width;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(width - pad - totalWidth - 8, totalY + 66, totalWidth + 16, 26);
  write(total, width - pad, totalY + 22, 76, colors.ink, 900, "display", "right");
  write(
    "GalacticBet · Marcador a 90 minutos · Aportaciones anotadas",
    pad,
    totalY + 134,
    17,
    colors.muted,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("No se pudo crear la imagen.")),
      "image/png",
    ),
  );
}
