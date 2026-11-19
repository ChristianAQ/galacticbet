import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import UpcomingSchedule from "../components/UpcomingSchedule";
import NewsSection from "../components/NewsSection";
import {
  HomeTools,
  MatchTicker,
  QuinielaSpotlight,
} from "../components/HomeWidgets";
import { PageTitle } from "../components/ui";
import type { Group } from "../lib/data";
import type { Match } from "../lib/domain";
import { openRounds } from "../lib/homeDashboard";
import { upcomingMatches } from "../lib/schedule";

const dayParts = new Intl.DateTimeFormat("es", {
  weekday: "long",
  day: "numeric",
  month: "short",
});
/** «jueves, 19 nov» → «Jueves 19 nov», printed as the masthead dateline. */
function dateline(now: number) {
  return dayParts
    .formatToParts(now)
    .filter((p) => p.type !== "literal")
    .map((p) => p.value.replace(".", ""))
    .join(" ");
}

export default function HomePage({
  userId,
  user,
  groups,
  matches,
  loading,
  demo = false,
  onLogin,
}: {
  userId: string;
  user: User | null;
  groups: Group[];
  matches: Match[];
  loading: boolean;
  demo?: boolean;
  onLogin: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) setNow(Date.now());
    };
    const interval = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const upcoming = useMemo(() => upcomingMatches(matches, now), [matches, now]);
  const rounds = useMemo(() => openRounds(matches, now), [matches, now]);
  const firstName = user?.displayName?.trim().split(/\s+/)[0];
  return (
    <div className="home-page">
      <PageTitle
        eyebrow={dateline(now)}
        title={firstName ? `Hola, ${firstName}` : "Hoy se juega"}
        navTitle="Inicio"
      >
        <QuinielaSpotlight
          rounds={rounds}
          now={now}
          userId={userId}
          loading={loading}
        />
      </PageTitle>
      {!loading && <MatchTicker matches={matches} now={now} />}
      <UpcomingSchedule
        matches={matches}
        upcoming={upcoming}
        now={now}
        loading={loading}
      />
      <HomeTools user={user} groups={groups} onLogin={onLogin} />
      <NewsSection demo={demo} />
    </div>
  );
}
