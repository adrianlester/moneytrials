import { redirect } from "next/navigation";
import { q } from "@/lib/db";
import { currentSeason } from "@/lib/seed";
import { DEMO_LOGINS, demoMode } from "@/lib/demo";
import { loginAction } from "../actions";

export const dynamic = "force-dynamic";

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

  const { e } = await searchParams;
  const players = await q<{ display_name: string }>(
    `SELECT display_name FROM player WHERE season_id = $1 ORDER BY role, display_name`,
    [season.id],
  );

  return (
    <main>
      <h1>{season.name}</h1>
      <p className="sub">Twelve weeks. Every pound gets a job.</p>

      {demoMode() && (
        <div className="note">
          <p style={{ marginTop: 0 }}>
            This is a demo with made-up players, three weeks into a season. Try it as a player or as the parent:
          </p>
          <p>{DEMO_LOGINS.map((l) => `${l.name} (${l.role}) ${l.pin}`).join(" · ")}</p>
          <p style={{ marginBottom: 0 }}>
            It resets every night.{" "}
            <a href="https://github.com/adrianlester/moneytrials">How it was built</a>
          </p>
        </div>
      )}

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
