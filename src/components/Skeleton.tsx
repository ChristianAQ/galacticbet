import type { CSSProperties } from "react";

/**
 * Placeholder blocks shaped like the content that is coming. The shimmer is a
 * translated highlight (transform only) and stops with reduced motion.
 */
export function Skeleton({
  width,
  height = 14,
  radius,
  className = "",
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={`skeleton ${className}`}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** A list of fixture-like rows: crest, name, score, name, crest. */
export function SkeletonRows({
  rows = 4,
  label = "Cargando",
  variant = "fixture",
}: {
  rows?: number;
  label?: string;
  variant?: "fixture" | "line" | "card";
}) {
  return (
    <div className={`skeleton-list is-${variant}`} role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) =>
        variant === "fixture" ? (
          <div className="skeleton-fixture" key={i}>
            <Skeleton width={28} height={28} radius="50%" />
            <Skeleton width={`${46 + ((i * 17) % 30)}%`} height={13} />
            <Skeleton width={44} height={22} radius={6} />
          </div>
        ) : variant === "card" ? (
          <div className="skeleton-card" key={i}>
            <Skeleton width="40%" height={11} />
            <Skeleton width="85%" height={18} />
            <Skeleton width="65%" height={13} />
          </div>
        ) : (
          <div className="skeleton-line" key={i}>
            <Skeleton width={`${70 + ((i * 13) % 25)}%`} height={13} />
            <Skeleton width="38%" height={11} />
          </div>
        ),
      )}
    </div>
  );
}

/** Whole-page placeholder while a route chunk downloads. */
export function PageSkeleton() {
  return (
    <div className="page-skeleton" role="status" aria-label="Cargando página">
      <div className="masthead page-skeleton-masthead">
        <Skeleton width={110} height={11} className="on-ink" />
        <Skeleton width="62%" height={38} radius={8} className="on-ink" />
      </div>
      <div className="page-body">
        <SkeletonRows rows={5} label="Cargando contenido" />
      </div>
    </div>
  );
}
