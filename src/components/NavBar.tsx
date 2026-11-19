import { ChevronLeft } from "lucide-react";
import { useLocation } from "react-router-dom";
import type { AppUser as User } from "../lib/session";
import { useChrome } from "../lib/chrome";
import {
  go,
  goBack,
  isTabRoot,
  parentOf,
  routeTitle,
} from "../lib/navigation";
import { haptic, prefersReducedMotion } from "../lib/motion";
import { preloadPage } from "../lib/pages";
import BrandMark from "./BrandMark";

/**
 * Fixed iOS-style navigation bar on the ink masthead: back button with the
 * previous screen's name, compact title that appears once the large title has
 * scrolled under it, and your avatar on the tab roots.
 */
export default function NavBar({ user }: { user: User | null }) {
  const { pathname } = useLocation();
  const { depth, top, previous } = useChrome();
  const root = isTabRoot(pathname);
  const canGoBack = depth > 1 || !root;
  const backLabel =
    depth > 1
      ? previous?.title || "Atrás"
      : routeTitle(parentOf(pathname)) || "Inicio";
  const title = top.title || routeTitle(pathname);
  // The four tab roots wear the brand in the middle (a phone has no sidebar
  // to carry it). Scrolling hands the spot to the compact title, except on
  // Inicio, where the brand stays.
  const branded = root && depth <= 1;
  const keepsBrand = branded && pathname === "/";
  const brandHidden = branded && !keepsBrand && Boolean(top.collapsed);
  return (
    <header
      className={`nav-bar topbar${top.collapsed ? " is-collapsed" : ""}${branded ? " has-brand" : ""}${keepsBrand ? " keeps-brand" : ""}`}
    >
      <div className="nav-bar-inner">
        <div className="nav-bar-leading">
          {canGoBack && (
            <button
              type="button"
              className="nav-back"
              onClick={() => {
                haptic();
                goBack();
              }}
              aria-label={`Volver a ${backLabel}`}
            >
              <ChevronLeft size={26} strokeWidth={2.4} aria-hidden="true" />
              <span>{backLabel}</span>
            </button>
          )}
        </div>
        <div className="nav-bar-center">
          {branded && (
            <button
              type="button"
              className="nav-brand"
              aria-label="GalacticBet, volver arriba"
              aria-hidden={brandHidden || undefined}
              tabIndex={brandHidden ? -1 : undefined}
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: prefersReducedMotion() ? "auto" : "smooth",
                })
              }
            >
              <BrandMark size={28} />
              <span className="nav-brand-word" aria-hidden="true">
                galactic<b>bet</b>
              </span>
            </button>
          )}
          <div
            className="nav-bar-title"
            aria-hidden={!top.collapsed || keepsBrand}
          >
            {title}
          </div>
        </div>
        <div className="nav-bar-trailing" id="nav-actions">
          {root && (
            <button
              type="button"
              className="nav-avatar"
              aria-label={user ? `Tu perfil, ${user.displayName || "jugador"}` : "Perfil y ajustes"}
              onPointerDown={() => void preloadPage("/perfil")}
              onClick={() => go("/perfil")}
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span>{(user?.displayName || "Tú").charAt(0).toUpperCase()}</span>
              )}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
