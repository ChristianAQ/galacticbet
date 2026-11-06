import { Plus, UserPlus } from "lucide-react";
import { Link } from "react-router-dom";

/** Entry points reuse the existing group page and its create/join dialogs. */
export default function GroupActions({
  onCreate,
  onJoin,
}: {
  onCreate?: () => void;
  onJoin?: () => void;
}) {
  const actions = [
    {
      id: "create",
      label: "Crear grupo",
      icon: Plus,
      style: "primary",
      onClick: onCreate,
    },
    {
      id: "join",
      label: "Unirme a grupo",
      icon: UserPlus,
      style: "secondary",
      onClick: onJoin,
    },
  ];
  return (
    <div
      className="group-bottom-actions"
      role="group"
      aria-label="Acciones de grupo"
    >
      {actions.map((action) =>
        action.onClick ? (
          <button
            key={action.id}
            type="button"
            className={`button ${action.style}`}
            onClick={action.onClick}
          >
            <action.icon size={18} aria-hidden="true" />
            {action.label}
          </button>
        ) : (
          <Link
            key={action.id}
            className={`button ${action.style}`}
            to={`/grupos?action=${action.id}`}
          >
            <action.icon size={18} aria-hidden="true" />
            {action.label}
          </Link>
        ),
      )}
    </div>
  );
}
