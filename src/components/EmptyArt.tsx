import type { ReactNode } from "react";

/**
 * Line illustrations for empty states, drawn like marker on the quiniela slip:
 * ink strokes and one stroke of yellow highlighter.
 */
export type EmptyArtKind =
  | "net"
  | "whistle"
  | "bench"
  | "slip"
  | "flag"
  | "podium"
  | "paper";

const marker = { stroke: "var(--accent)", strokeWidth: 7, opacity: 0.9 };

export default function EmptyArt({ kind }: { kind: EmptyArtKind }) {
  return (
    <svg
      className="empty-art"
      viewBox="0 0 160 104"
      width="160"
      height="104"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {art[kind]}
    </svg>
  );
}

const art: Record<EmptyArtKind, ReactNode> = {
  // An empty goal: nothing has gone in yet.
  net: (
    <>
      <path d="M44 94h76" {...marker} />
      <path d="M10 88h140" />
      <path d="M30 88V24h100v64" strokeWidth="4" />
      <path d="M30 24l14 11h72l14-11M44 35v53M116 35v53" />
      <path
        d="M56 35v53M68 35v53M80 35v53M92 35v53M104 35v53M44 48h72M44 61h72M44 74h72"
        opacity=".4"
      />
    </>
  ),
  // The referee has not blown yet.
  whistle: (
    <>
      <path d="M38 90h70" {...marker} />
      <circle cx="66" cy="62" r="20" />
      <path d="M78 46l42-12v18l-34 8" />
      <circle cx="66" cy="62" r="6" />
      <path d="M46 52c-12-8-14-26-2-34" opacity=".5" />
      <path d="M128 22l8-6M132 34h10M126 12l3-8" />
    </>
  ),
  // Nobody on the bench.
  bench: (
    <>
      <path d="M30 92h100" {...marker} />
      <path d="M18 88h124" />
      <path d="M28 56h104M28 66h104M36 66v22M124 66v22M28 40h104v16" />
      <path d="M44 40V30M116 40V30" opacity=".5" />
      <path d="M98 76h8v12h-8zM100 76v-5h4v5" />
    </>
  ),
  // A blank quiniela slip with one box waiting for your X.
  slip: (
    <>
      <path d="M34 14h92v76H34z" />
      <path d="M34 34h92" opacity=".5" />
      <path d="M46 24h30" />
      <path d="M90 46h10v10H90zM104 46h10v10h-10zM76 46h10v10H76zM90 62h10v10H90zM104 62h10v10h-10zM76 62h10v10H76z" opacity=".55" />
      <path d="M46 51h20M46 67h20" opacity=".55" />
      <path d="M102 78h14" {...marker} strokeWidth={10} />
      <path d="M104 74l10 10M114 74l-10 10" strokeWidth="3" />
    </>
  ),
  // Linesman's flag: offside.
  flag: (
    <>
      <path d="M40 94h64" {...marker} />
      <path d="M58 90V14" strokeWidth="3.5" />
      <path d="M58 16h44l-8 14 8 14H58" />
      <path d="M58 16h22v28H58z" fill="var(--accent)" stroke="none" opacity=".9" />
      <path d="M58 16h44l-8 14 8 14H58" />
      <path d="M118 30l10-4M118 42h12" opacity=".5" />
    </>
  ),
  // An empty podium, waiting for points.
  podium: (
    <>
      <path d="M58 30h44" {...marker} />
      <path d="M16 90h128" />
      <path d="M58 90V42h44v48M22 90V58h36M102 66h36v24" />
      <path d="M80 56v14" strokeWidth="3.5" />
      <path d="M40 72v8M120 76v6" opacity=".6" />
      <circle cx="80" cy="22" r="6" strokeDasharray="3 4" opacity=".6" />
    </>
  ),
  // A newspaper with nothing printed today.
  paper: (
    <>
      <path d="M36 92h88" {...marker} />
      <path d="M30 16h92v70H38a8 8 0 0 1-8-8z" />
      <path d="M122 30h8v48a8 8 0 0 1-8 8" />
      <path d="M42 30h44" strokeWidth="5" />
      <path d="M42 44h68M42 54h68M42 64h40" opacity=".4" />
    </>
  ),
};
