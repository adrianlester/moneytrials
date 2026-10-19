import { redirect } from "next/navigation";
import { currentSeason } from "@/lib/seed";
import { londonToday } from "@/lib/engine";
import { createSeasonAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Setup() {
  const existing = await currentSeason();
  if (existing && existing.status !== "ended") redirect("/login");

  const today = londonToday();

  return (
    <main>
      <h1>Set up the season</h1>
      <p className="sub">Three accounts: two players and you. Done once.</p>

      <form action={createSeasonAction}>
        <div className="card">
          <div className="field">
            <label htmlFor="name">Season name</label>
            <input id="name" name="name" defaultValue="The Season" />
          </div>
          <div className="field">
            <label htmlFor="start_date">Starts</label>
            <input id="start_date" name="start_date" type="date" defaultValue={today} />
          </div>
          <div className="field">
            <label htmlFor="weeks">Weeks</label>
            <input id="weeks" name="weeks" type="number" defaultValue={12} min={1} max={52} />
          </div>
          <div className="field">
            <label htmlFor="payday_weekday">Payday</label>
            <select id="payday_weekday" name="payday_weekday" defaultValue="6">
              <option value="6">Saturday</option>
              <option value="0">Sunday</option>
              <option value="1">Monday</option>
              <option value="5">Friday</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="charity_frequency">Giving asks</label>
            <select id="charity_frequency" name="charity_frequency" defaultValue="normal">
              <option value="sparse">Sparse</option>
              <option value="normal">Normal</option>
              <option value="generous">Generous</option>
            </select>
            <p className="hint">Fixed for the whole season. Tune it between seasons, not during one.</p>
          </div>
        </div>

        {[
          { slot: "p1", heading: "Player one", craft: "crochet" },
          { slot: "p2", heading: "Player two", craft: "baking" },
        ].map((p) => (
          <div className="card" key={p.slot}>
            <h2 style={{ marginTop: 0 }}>{p.heading}</h2>
            <div className="field">
              <label htmlFor={`${p.slot}_name`}>Name</label>
              <input id={`${p.slot}_name`} name={`${p.slot}_name`} autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor={`${p.slot}_pin`}>4-digit PIN</label>
              <input
                id={`${p.slot}_pin`} name={`${p.slot}_pin`}
                inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor={`${p.slot}_wage`}>Base weekly wage</label>
              <span className="pound"><input id={`${p.slot}_wage`} name={`${p.slot}_wage`} defaultValue="95" inputMode="decimal" /></span>
              <p className="hint">Income is lumpy on purpose — some weeks are short, some are big, one in twenty is nothing.</p>
            </div>
            <div className="field">
              <label htmlFor={`${p.slot}_craft`}>Side hustle</label>
              <select id={`${p.slot}_craft`} name={`${p.slot}_craft`} defaultValue={p.craft}>
                <option value="crochet">Crochet</option>
                <option value="baking">Baking</option>
                <option value="art">Art prints</option>
                <option value="jewellery">Jewellery</option>
              </select>
            </div>
          </div>
        ))}

        <div className="card">
          <h2 style={{ marginTop: 0 }}>You (admin)</h2>
          <div className="field">
            <label htmlFor="admin_name">Name</label>
            <input id="admin_name" name="admin_name" defaultValue="Dad" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="admin_pin">4-digit PIN</label>
            <input
              id="admin_pin" name="admin_pin"
              inputMode="numeric" pattern="[0-9]*" maxLength={4} autoComplete="off"
            />
          </div>
        </div>

        <button className="primary" type="submit">Create the season</button>
      </form>
    </main>
  );
}
