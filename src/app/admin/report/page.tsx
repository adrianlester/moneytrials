import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { endSeasonIfDone, londonToday } from "@/lib/engine";
import { seasonReport } from "@/lib/report";
import { ReportView } from "../../report-view";
import { AdminNav } from "../admin-nav";

export const dynamic = "force-dynamic";

/** Both players' reports, one after the other. Kept as three results each; never one score. */
export default async function AdminReport() {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  await endSeasonIfDone(season.id, londonToday());
  const ended = (await currentSeason())?.status === "ended";
  const players = await q<{ id: string }>(
    `SELECT id FROM player WHERE season_id = $1 AND role = 'player' ORDER BY display_name`, [season.id],
  );
  const reports = await Promise.all(players.map((p) => seasonReport(p.id)));

  return (
    <main>
      <h1>{ended ? "Season report" : "Report so far"}</h1>
      <p className="sub">{season.name}. Three results each, kept apart.</p>
      {reports.map((r) => (
        <section key={r.name}>
          <h1 style={{ marginTop: 28 }}>{r.name}</h1>
          <ReportView r={r} final={ended} />
        </section>
      ))}
      <AdminNav on="report" />
    </main>
  );
}
