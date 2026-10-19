import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { currentPlayer } from "@/lib/auth";
import { gbp } from "@/lib/money";
import { logoutAction } from "../actions";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

/**
 * The ledger is the source of truth; envelope balances are derived from it.
 * This screen exists so that claim is checkable by eye.
 */
export default async function Ledger() {
  const me = await currentPlayer();
  if (!me) redirect("/login");

  const rows = await q<{ day: string; type: string; amount: number; note: string }>(
    `SELECT day, type, amount, note FROM ledger
      WHERE player_id = $1 ORDER BY day DESC, created_at DESC LIMIT 120`,
    [me.id],
  );

  const totals = await q<{ type: string; total: string | number }>(
    `SELECT type, SUM(amount) AS total FROM ledger WHERE player_id = $1 GROUP BY type`,
    [me.id],
  );
  const given = totals
    .filter((t) => t.type === "committed_giving" || t.type === "giving" || t.type === "gift")
    .reduce((n, t) => n + Math.abs(Number(t.total)), 0);

  return (
    <main>
      <h1>Ledger</h1>
      <p className="sub">Everything that has happened to your money.</p>

      {given > 0 && (
        <div className="card">
          <div className="row">
            <span className="label">Given this season<span className="blurb">Reported, not scored</span></span>
            <span className="amount">{gbp(given)}</span>
          </div>
        </div>
      )}

      <div className="card">
        {rows.length === 0 && <p className="sub">Nothing yet.</p>}
        {rows.map((r, i) => (
          <div className="ledger-row" key={i}>
            <span>
              {r.note || r.type}
              <span className="d"> {String(r.day).slice(0, 10)}</span>
            </span>
            <span className={`a${r.amount > 0 ? " in" : ""}`}>
              {r.amount > 0 ? "+" : ""}{gbp(r.amount)}
            </span>
          </div>
        ))}
      </div>

      <form action={logoutAction}>
        <button type="submit">Sign out</button>
      </form>

      <Nav on="ledger" />
    </main>
  );
}
