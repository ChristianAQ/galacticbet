/**
 * The GalacticBet mark: a quiniela box with a marker cross, on yellow.
 * Same geometry as the app icon.
 */
export default function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <rect
        x="15"
        y="15"
        width="34"
        height="34"
        rx="5"
        fill="none"
        stroke="#15140f"
        strokeWidth="5"
      />
      <path
        d="M24 25 40 39.5M39 24 25 40.5"
        fill="none"
        stroke="#15140f"
        strokeWidth="6.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
