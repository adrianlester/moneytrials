import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { gbp } from "@/lib/money";
import { londonToday, weekFor } from "@/lib/engine";
import { allFundraisers, decks } from "@/lib/admin";
import {
  buildDeckAction, commitmentDecisionAction, extendAction, frequencyAction,
  matchAction, pauseAction, playerAction, resumeAction,
} from "../admin-actions";
import { AdminNav } from "./admin-nav";

export const dynamic = "force-dynamic";

export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; e?: string }>;
}) {
  const { m, e } = await searchParams;
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const day = londonToday();
  const week = await weekFor(season.id, day);
  const players = await q<{ id: string; display_name: string; base_wage: number; wage_variance: boolean; deck_id: string; craft: string | null }>(
    `SELECT id, display_name, base_wage, wage_variance, deck_id, craft FROM player
      WHERE season_id = $1 AND role = 'player' ORDER BY display_name`, [season.id],
  );
  const requests = await q<{ id: string; name: string; new_amount: number; current: number }>(
    `SELECT r.id, p.display_name AS name, r.new_amount, c.amount AS current
       FROM commitment_request r JOIN player p ON p.id = r.player_id JOIN commitment c ON c.player_id = r.player_id
      WHERE p.season_id = $1 AND r.status = 'pending'`, [season.id],
  );
  const funds = await allFundraisers(season.id);
  const deckList = await decks();
  const waiting = requests.length;

  return (
    <main>
      <h1>Admin</h1>
      <p className="sub">
        {season.name} · {season.status}
        {week ? ` · week ${week.idx} of ${season.weeks}` : ""}
        {waiting > 0 ? ` · ${waiting} waiting on you` : ""}
      </p>
      {m && <div className="note">{m}</div>}
      {e && <div className="note err">{e}</div>}

      <h2>Waiting on you</h2>
      {waiting === 0 && <div className="card"><p className="sub">Nothing waiting.</p></div>}
      {requests.map((r) => (
        <form action={commitmentDecisionAction} className="card" key={r.id}>
          <input type="hidden" name="request_id" value={r.id} />
          <p><strong>{r.name} wants to change Committed Giving</strong></p>
          <p className="sub">From {gbp(r.current)} to {gbp(r.new_amount)} a week, from the next payday.</p>
          <button type="submit" name="decision" value="approve" className="primary">Approve</button>
          <button type="submit" name="decision" value="decline">Decline</button>
        </form>
      ))}


      <h2>Players</h2>
      {players.map((p) => (
        <form action={playerAction} className="card" key={p.id}>
          <input type="hidden" name="player_id" value={p.id} />
          <p><strong>{p.display_name}</strong> <span className="sub">{p.craft ?? ""}</span></p>
          <div className="field">
            <label htmlFor={`wage-${p.id}`}>Base weekly wage</label>
            <span className="pound"><input id={`wage-${p.id}`} name="wage" defaultValue={(p.base_wage / 100).toFixed(2)} inputMode="decimal" /></span>
          </div>
          <div className="field">
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="variance" defaultChecked={p.wage_variance} style={{ width: "auto", minHeight: 0, margin: 0 }} />
              Lumpy income (some weeks short or bigger, one in twenty nothing)
            </label>
          </div>
          <div className="field">
            <label htmlFor={`deck-${p.id}`}>Event deck (the player is never told)</label>
            <select id={`deck-${p.id}`} name="deck" defaultValue={p.deck_id}>
              {deckList.map((d) => <option key={d.id} value={d.id}>{d.id}{d.overrides ? ` (${d.overrides} cards changed)` : ""}</option>)}
            </select>
          </div>
          <button type="submit">Save</button>
          <p className="hint" style={{ marginTop: 10 }}>A new wage applies to every week not yet paid.</p>
        </form>
      ))}

      <details className="card">
        <summary>Build a difficulty deck</summary>
        <p className="hint" style={{ marginTop: 10 }}>
          Makes a copy of every card with the costs scaled, the same wording and the same amounts in the
          text. Both players are still dealt the same card each day. Try gentle at 0.8 or tough at 1.25.
          Building a deck again overwrites its automatic changes. Edit single cards under Cards.
        </p>
        <form action={buildDeckAction}>
          <div className="field">
            <label htmlFor="deck_name">Deck name</label>
            <input id="deck_name" name="deck" defaultValue="gentle" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="deck_factor">Costs multiplied by</label>
            <input id="deck_factor" name="factor" defaultValue="0.8" inputMode="decimal" />
          </div>
          <button type="submit">Build it</button>
        </form>
      </details>

      <h2>Fundraisers</h2>
      {funds.length === 0 && <div className="card"><p className="sub">None yet.</p></div>}
      {funds.map((f) => {
        const raised = f.sponsors + f.fromSales + f.matched;
        return (
          <form action={matchAction} className="card" key={f.id}>
            <input type="hidden" name="fundraiser_id" value={f.id} />
            <div className="goal-head">
              <span className="n">{f.player}: {f.cause}</span>
              <span className="p">{gbp(raised)} of {gbp(f.target)}</span>
            </div>
            <p className="sub" style={{ marginTop: 6 }}>
              {f.method === "sales" ? "Selling" : "Sponsored event"} · sponsors {gbp(f.sponsors)}, sales {gbp(f.fromSales)}, added by you {gbp(f.matched)} · {f.closes >= day ? `open to ${f.closes}` : "finished"}
            </p>
            <div className="field">
              <label htmlFor={`m-${f.id}`}>Add to it</label>
              <span className="pound"><input id={`m-${f.id}`} name="amount" defaultValue={((f.sponsors + f.fromSales) / 100).toFixed(2)} inputMode="decimal" /></span>
            </div>
            <button type="submit">Match</button>
          </form>
        );
      })}

      <h2>The season</h2>
      <div className="card">
        {season.status === "paused" ? (
          <form action={resumeAction}>
            <p className="sub">Paused since {String(season.paused_on).slice(0, 10)}. Weeks that had not started will move out by the time it was paused.</p>
            <button type="submit" className="primary">Resume</button>
          </form>
        ) : season.status === "running" ? (
          <form action={pauseAction}>
            <p className="sub">Pausing freezes play. Nobody can plan, spend or choose until you resume.</p>
            <button type="submit">Pause the season</button>
          </form>
        ) : (
          <p className="sub">The season has ended. Adding weeks re-opens it.</p>
        )}
      </div>
      <form action={extendAction} className="card">
        <div className="field">
          <label htmlFor="ext">Add weeks to the end</label>
          <input id="ext" name="weeks" defaultValue="1" inputMode="numeric" />
        </div>
        <button type="submit">Add</button>
      </form>
      <form action={frequencyAction} className="card">
        <div className="field">
          <label htmlFor="freq">How often unannounced asks turn up</label>
          <select id="freq" name="frequency" defaultValue={season.charity_frequency}>
            <option value="sparse">Sparse</option>
            <option value="normal">Normal</option>
            <option value="generous">Generous</option>
          </select>
        </div>
        <button type="submit">Save</button>
        <p className="hint" style={{ marginTop: 10 }}>Asks that have already arrived stay. The rest are drawn again.</p>
      </form>

      <AdminNav on="overview" />
    </main>
  );
}
