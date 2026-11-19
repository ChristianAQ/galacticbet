import CompetitionLogo from "./CompetitionLogo";
import { COMPETITION_CODES, competitionName } from "../lib/competitions";
import {
  ArrowUpRight,
  CircleHelp,
  LogIn,
  NotebookPen,
  Plus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "react-router-dom";
import { useChrome } from "../lib/chrome";
import BrandMark from "./BrandMark";

/**
 * Desktop and tablet rail. Phones use the tab bar instead; everything listed
 * here is also reachable from Inicio and Perfil.
 */
export default function Sidebar({
  items,
  onPrefetch,
}: {
  onPrefetch?: (path: string) => void;
  items: { to: string; label: string; icon: LucideIcon }[];
}) {
  const { pathname } = useLocation();
  const { rootPath } = useChrome();
  const prefetch = (to: string) => ({
    onPointerEnter: () => onPrefetch?.(to),
    onFocus: () => onPrefetch?.(to),
  });
  return (
    <aside id="app-sidebar" className="sidebar" aria-label="Menú principal">
      <a className="brand" href="#/" data-nav="tab" aria-label="GalacticBet, inicio">
        <BrandMark />
        <span className="brand-word">
          galactic<b>bet</b>
        </span>
      </a>
      <nav aria-label="Secciones" className="sidebar-nav">
        {items.map((item) => (
          <a
            key={item.to}
            href={`#${item.to}`}
            data-nav="tab"
            className={rootPath === item.to ? "active" : undefined}
            aria-current={pathname === item.to ? "page" : undefined}
            {...prefetch(item.to)}
          >
            <item.icon size={19} aria-hidden="true" />
            {item.label}
          </a>
        ))}
      </nav>
      <div className="sidebar-group">
        <span className="sidebar-caption">Herramientas</span>
        <a href="#/porra" className={pathname === "/porra" ? "active" : undefined} {...prefetch("/porra")}>
          <NotebookPen size={18} aria-hidden="true" /> Porra rápida
        </a>
        <a href="#/equipos" className={pathname === "/equipos" ? "active" : undefined} {...prefetch("/equipos")}>
          <Users size={18} aria-hidden="true" /> Equipos y jugadores
        </a>
      </div>
      <div className="sidebar-group">
        <span className="sidebar-caption">Competiciones</span>
        {COMPETITION_CODES.map((code) => (
          <a key={code} href={`#/ligas?competition=${code}`}>
            <CompetitionLogo code={code} small />
            {competitionName(code)}
          </a>
        ))}
      </div>
      <div className="sidebar-bottom">
        <div className="friend-card">
          <strong>El fútbol, con los tuyos.</strong>
          <p>Monta una liga privada y demuestra quién sabe más.</p>
          <a href="#/grupos?action=create">
            <Plus size={15} aria-hidden="true" /> Crear mi grupo
          </a>
          <a href="#/grupos?join=1">
            <LogIn size={15} aria-hidden="true" /> Unirme con un código
          </a>
        </div>
        <a href="#/perfil?tab=play" className="sidebar-help">
          <CircleHelp size={17} aria-hidden="true" />
          Ayuda y cómo jugar
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </aside>
  );
}
