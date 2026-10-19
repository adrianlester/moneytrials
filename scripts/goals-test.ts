/**
 * Buying a goal and starting the next. Run against a throwaway PGlite:
 * PGLITE_DIR=$TEMP/goals-test npx tsx --conditions=react-server scripts/goals-test.ts
 */
import { q, one } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import { addGoal, buyGoal, envelopeOf, syncGoalsEnvelope, weekFor } from "../src/lib/engine";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const seasonId = await createSeason({
    name: "t", startDate: "2026-10-06", weeks: 12, charityFrequency: "normal", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
    ],
  });
  const robin = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Robin'`))!.id;
  const day = "2026-10-06";
  const week = (await weekFor(seasonId, day))!;
  await q(`INSERT INTO goal (player_id, name, target_amount) VALUES ($1,'Stall kit',22000)`, [robin]);
  await q(`INSERT INTO goal (player_id, name, target_amount) VALUES ($1,'Skates',16500)`, [robin]);
  const goals = await q<{ id: string; name: string }>(`SELECT id, name FROM goal WHERE player_id=$1 ORDER BY created_at`, [robin]);
  const [kit, skates] = goals;

  const env = await envelopeOf(robin, "goals");
  await q(`UPDATE envelope SET balance = 20000 WHERE id = $1`, [env.id]);
  await syncGoalsEnvelope(robin);

  let r = await buyGoal(robin, week.id, day, kit.id);
  check("cannot buy a goal that is not fully funded", !r.ok, r.ok ? "" : r.error);

  await q(`UPDATE envelope SET balance = 40000 WHERE id = $1`, [env.id]);
  await syncGoalsEnvelope(robin);
  const saved = async (id: string) =>
    Number((await one<{ s: number }>(`SELECT saved_amount AS s FROM goal WHERE id=$1`, [id]))!.s);
  check("both goals funded from a £400 pot", (await saved(kit.id)) === 22000 && (await saved(skates.id)) === 16500);

  r = await buyGoal(robin, week.id, day, kit.id);
  check("buying the stall kit works", r.ok);
  check("price left the pot", (await envelopeOf(robin, "goals")).balance === 40000 - 22000);
  const owned = await one<{ b: string | null }>(`SELECT bought_at AS b FROM goal WHERE id=$1`, [kit.id]);
  check("goal is marked bought", owned?.b != null);
  check("skates still funded from what is left", (await saved(skates.id)) === 16500);

  const ledger = await one<{ amount: number; note: string }>(
    `SELECT amount, note FROM ledger WHERE player_id=$1 AND type='goal_bought'`, [robin]);
  check("ledger records it", ledger?.amount === -22000 && ledger.note === "Bought — Stall kit", JSON.stringify(ledger));

  r = await buyGoal(robin, week.id, day, kit.id);
  check("cannot buy it twice", !r.ok);

  // Bought goals no longer take from the pot.
  await q(`UPDATE envelope SET balance = 5000 WHERE id = $1`, [env.id]);
  await syncGoalsEnvelope(robin);
  check("pot fills the next goal, not the bought one", (await saved(skates.id)) === 5000 && (await saved(kit.id)) === 22000);

  // The reset.
  let a = await addGoal(robin, "Yarn winder", 6500);
  check("a third goal can be added", a.ok);
  a = await addGoal(robin, "Another", 1000);
  check("a third open goal is allowed", a.ok);
  a = await addGoal(robin, "another", 1000);
  const dupes = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM goal WHERE player_id=$1 AND bought_at IS NULL AND lower(name)='another'`, [robin]);
  check("the same goal sent twice is one goal", a.ok && Number(dupes?.n) === 1, `${dupes?.n}`);
  a = await addGoal(robin, "One too many", 1000);
  check("a fourth open goal is refused", !a.ok, a.ok ? "" : a.error);
  await buyGoal(robin, week.id, day, skates.id).catch(() => null);
  a = await addGoal(robin, "", 1000);
  check("a goal needs a name", !a.ok);
  a = await addGoal(robin, "Free thing", 0);
  check("a goal needs a price", !a.ok);

  // Being raided below the price after reaching it blocks buying.
  await q(`UPDATE envelope SET balance = 3000 WHERE id = $1`, [env.id]);
  await syncGoalsEnvelope(robin);
  const r2 = await buyGoal(robin, week.id, day, skates.id);
  check("a goal raided below its price cannot be bought", !r2.ok, r2.ok ? "" : r2.error);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
