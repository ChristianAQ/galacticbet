import { useSearchParams } from "react-router-dom";
import Segmented from "../components/Segmented";
import { PageTitle, PrivateGate } from "../components/ui";
import type { Group } from "../lib/data";
import type { Match } from "../lib/domain";
import type { AppUser } from "../lib/session";
import PredictionsPage from "./PredictionsPage";
import StandingsPage from "./StandingsPage";
import "../styles/quiniela.css";

export type QuinielaView = "boleto" | "clasificacion";
export const quinielaView = (value: string | null): QuinielaView =>
  value === "clasificacion" ? "clasificacion" : "boleto";

/**
 * Quiniela and Clasificación in one tab: your slip or the table, over the same
 * group, competition (official or your own) and round. Switching keeps all
 * three: they live in the shared preferences and in the URL (?round=).
 */
export default function QuinielaPage({
  matches,
  groups,
  groupsReady,
  user,
  demo,
  loading,
  onLogin,
  onDemo,
}: {
  matches: Match[];
  groups: Group[];
  groupsReady: boolean;
  user: AppUser | null;
  demo: boolean;
  loading: boolean;
  onLogin: () => void;
  onDemo: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const view = quinielaView(params.get("vista"));
  const tabs = (
    <div className="quiniela-views">
      <Segmented<QuinielaView>
        label="Quiniela"
        value={view}
        options={[
          { value: "boleto", label: "Mi boleto" },
          { value: "clasificacion", label: "Clasificación" },
        ]}
        onChange={(next) =>
          setParams(
            (previous) => {
              const url = new URLSearchParams(previous);
              if (next === "clasificacion") url.set("vista", next);
              else url.delete("vista");
              return url;
            },
            { replace: true },
          )
        }
      />
    </div>
  );
  if (view === "clasificacion")
    return (
      <StandingsPage
        groups={groups}
        groupsReady={groupsReady}
        matches={matches}
        loading={loading}
        user={user}
        onLogin={onLogin}
        viewTabs={tabs}
      />
    );
  if (!user && !demo)
    return (
      <>
        <PageTitle title="Quiniela" eyebrow="Mi boleto" />
        {tabs}
        <PrivateGate onLogin={onLogin} onDemo={onDemo} />
      </>
    );
  return (
    <PredictionsPage
      matches={matches}
      groups={groups}
      groupsReady={groupsReady}
      user={user}
      demo={demo}
      viewTabs={tabs}
    />
  );
}
