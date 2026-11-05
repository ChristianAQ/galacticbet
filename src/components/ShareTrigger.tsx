import { Share2 } from "lucide-react";
import "../styles/live.css";

export default function ShareTrigger({
  label = "Compartir",
  disabled,
  onClick,
}: {
  label?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="share-trigger"
      disabled={disabled}
      onClick={onClick}
    >
      <Share2 size={14} aria-hidden="true" /> {label}
    </button>
  );
}
