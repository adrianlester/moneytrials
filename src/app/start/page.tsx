import Link from "next/link";
import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/auth";
import { causesFor, currentSeason } from "@/lib/seed";
import { logoutAction, playerSetupAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Start() {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.setup_done) redirect("/");

  const season = await currentSeason();
  if (!season) redirect("/setup");
  const causes = await causesFor(season.id);

  return (
    <main>
      <h1>Before you start</h1>
      <p className="sub">Two things, then you&apos;re playing.</p>
      <div className="note">
        New here? <Link href="/help">Read how it works first.</Link> It is in the Help tab afterwards too.
      </div>

      <form action={playerSetupAction}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>What are you saving for?</h2>
          <p className="hint">
            Real things with real prices. Two is plenty; you can add more later.
          </p>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ marginBottom: 14 }}>
              <input
                name={`goal${i}_name`}
                placeholder={i === 1 ? "Trainers" : i === 2 ? "Concert ticket" : "Something else"}
                autoComplete="off"
              />
              <span className="pound"><input
                name={`goal${i}_price`}
                placeholder={i === 1 ? "75" : i === 2 ? "48" : "price"}
                inputMode="decimal"
              /></span>
            </div>
          ))}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Committed giving</h2>
          <p className="hint">
            An amount that leaves every payday before you see it. You pick the number and
            it can be nothing. Once it&apos;s set it stays set for the season — you can change
            the cause whenever you like, but the amount needs asking.
          </p>
          <div className="field">
            <label htmlFor="committed_amount">Amount each week</label>
            <span className="pound"><input id="committed_amount" name="committed_amount" defaultValue="0" inputMode="decimal" /></span>
          </div>
          <div className="field">
            <label htmlFor="cause_id">Cause</label>
            <select id="cause_id" name="cause_id" defaultValue={causes[0]?.id ?? ""}>
              {causes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="custom_cause">Or name your own</label>
            <input id="custom_cause" name="custom_cause" placeholder="" autoComplete="off" />
          </div>
        </div>

        <input type="hidden" name="craft" value={me.craft ?? ""} />
        <button className="primary" type="submit">Start the season</button>
      </form>
      <form action={logoutAction} style={{ marginTop: 24 }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
