import { redirect } from "next/navigation";
import Link from "next/link";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { londonToday, endSeasonIfDone } from "@/lib/engine";
import { seasonReport } from "@/lib/report";
import { Nav } from "../nav";
import { ReportView } from "../report-view";

export const dynamic = "force-dynamic";

/** Reachable any time. Before the season ends it says "so far"; after, it is the season-end report. */
export default async function ReportPage() {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role === "admin") redirect("/admin/report");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  await endSeasonIfDone(season.id, londonToday());
  const ended = (await currentSeason())?.status === "ended";
  const r = await seasonReport(me.id);

  return (
    <main>
      <h1>{ended ? "The season is over" : "So far"}</h1>
      <p className="sub">
        {ended
          ? "Three results. They are kept apart on purpose."
          : "Where you are at the moment. The real report is here when the season ends."}
      </p>
      <ReportView r={r} final={ended} />
      <p className="sub"><Link href="/">Back to Today</Link></p>
      <Nav on="home" />
    </main>
  );
}
