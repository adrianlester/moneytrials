import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { currentSeason } from "@/lib/seed";
import { demoMode } from "@/lib/demo";
import { demoLoginAction, loginAction } from "../actions";

export const dynamic = "force-dynamic";

/** The demo's front door: one tap per made-up player, matching DEMO_LOGINS by name. */
const DEMO_DOORS = [
  { name: "Robin", label: "Play as Robin", blurb: "Careful with money, works extra shifts.", primary: true },
  { name: "Sam", label: "Play as Sam", blurb: "Hasn't been in this week, so payday is waiting.", primary: false },
  { name: "Dad", label: "Be the parent", blurb: "Sets wages and decides on the players' requests.", primary: false },
];

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const season = await currentSeason();
  if (!season) {
    if (demoMode()) {
      return (
        <main>
          <h1>The Money Trials</h1>
          <p className="sub">The demo is resetting. Try again in a minute.</p>
        </main>
      );
    }
    redirect("/setup");
  }

  if (demoMode()) {
    return (
      <main>
        <h1>The Money Trials</h1>
        <p className="sub">A 12-week budgeting game for teenagers.</p>

        <p>
          Each player has a Saturday job. Once a week they give every pound of their wage a job, and every other
          day they answer one short money question. A parent plays the world: sets wages and approves changes.
        </p>
        <p className="sub">
          These players are made up, three weeks into a season. Change anything you like: it resets every night.
        </p>

        <form action={demoLoginAction} className="demo-doors">
          {DEMO_DOORS.map((d) => (
            <button key={d.name} className={d.primary ? "primary" : undefined} type="submit" name="name" value={d.name}>
              {d.label}
              <span className="blurb">{d.blurb}</span>
            </button>
          ))}
        </form>

        <p className="sub">
          <a href="https://github.com/adrianlester/moneytrials/blob/main/WRITEUP.md">How it was built</a>
        </p>
      </main>
    );
  }

  const { e } = await searchParams;
  const players = await q<{ display_name: string }>(
    `SELECT display_name FROM player WHERE season_id = $1 ORDER BY role, display_name`,
    [season.id],
  );

  return (
    <main>
      <h1>{season.name}</h1>
      <p className="sub">Twelve weeks. Every pound gets a job.</p>

      {e && <div className="note err">That name and PIN don&apos;t match.</div>}

      <form action={loginAction} className="card">
        <div className="field">
          <label htmlFor="name">Who are you?</label>
          <select id="name" name="name" defaultValue={players[0]?.display_name ?? ""}>
            {players.map((p) => (
              <option key={p.display_name} value={p.display_name}>{p.display_name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            name="pin"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            autoComplete="off"
            placeholder="••••"
          />
        </div>
        <button className="primary" type="submit">Go</button>
      </form>
    </main>
  );
}
