import { redirect } from "next/navigation";
import Link from "next/link";
import { q } from "@/lib/db";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { gbp } from "@/lib/money";
import { ledgerFor } from "@/lib/admin";
import { AdminNav } from "../admin-nav";

export const dynamic = "force-dynamic";

/** Both players' full ledgers, read-only. */
export default async function AdminLedger({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const players = await q<{ id: string; display_name: string }>(
    `SELECT id, display_name FROM player WHERE season_id = $1 AND role = 'player' ORDER BY display_name`, [season.id],
  );
  const chosen = players.find((x) => x.id === p) ?? players[0];
  const rows = chosen ? await ledgerFor(chosen.id) : [];

  return (
    <main>
      <h1>Ledgers</h1>
      <p className="sub">
        {players.map((x) => (
          <Link key={x.id} href={`/admin/ledger?p=${x.id}`} style={{ marginRight: 14, fontWeight: x.id === chosen?.id ? 700 : 400 }}>
            {x.display_name}
          </Link>
        ))}
      </p>
      <div className="card">
        {rows.length === 0 && <p className="sub">Nothing yet.</p>}
        {rows.map((r, i) => (
          <div className="ledger-row" key={i}>
            <span>
              {r.note || r.type}
              <span className="d" style={{ display: "block" }}>{r.day} · {r.type}</span>
            </span>
            <span className={`a${r.amount > 0 ? " in" : ""}`}>{r.amount === 0 ? "" : gbp(r.amount)}</span>
          </div>
        ))}
      </div>
      <AdminNav on="ledger" />
    </main>
  );
}
