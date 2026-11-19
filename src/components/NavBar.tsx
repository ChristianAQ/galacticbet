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
import { haptic } from "../lib/motion";
import { preloadPage } from "../lib/pages";

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
  return (
    <header className={`nav-bar topbar${top.collapsed ? " is-collapsed" : ""}`}>
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
        <div className="nav-bar-title" aria-hidden={!top.collapsed}>
          {title}
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
