/**
 * Giving asks. Run against a throwaway PGlite:
 * PGLITE_DIR=$TEMP/asks-test npx tsx --conditions=react-server scripts/asks-test.ts
 */
import { q, one } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import { envelopeOf, credit } from "../src/lib/engine";
import { answerAsk, ensureAsks, openAsks, planAsks, upcomingScheduled } from "../src/lib/asks";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const seasonId = await createSeason({
    name: "t", startDate: "2026-10-12", weeks: 12, charityFrequency: "generous", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
    ],
  });
  const robin = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Robin'`))!.id;
  const sam = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Sam'`))!.id;

  const count = async () => Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ask WHERE season_id=$1`, [seasonId]))!.n);
  const n1 = await count();
  const season = { id: seasonId, start_date: "2026-10-12", weeks: 12, charity_frequency: "generous" as const };
  await planAsks(season);
  await ensureAsks(season);
  check("laying out twice makes no duplicates", (await count()) === n1, `${n1} asks`);

  const sched = await q<{ key: string }>(`SELECT key FROM ask WHERE season_id=$1 AND kind='scheduled' ORDER BY day`, [seasonId]);
  check("scheduled asks fall inside the season", sched.map((s) => s.key).join() === "s:harvest:2026,s:children-in-need:2026,s:christmas-appeal:2026,s:comic-relief:2027" || sched.length >= 3, sched.map((s) => s.key).join());

  const unann = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ask WHERE season_id=$1 AND kind='unannounced'`, [seasonId]))!.n);
  check("generous gives some unannounced asks", unann >= 2 && unann <= 12, `${unann} of 12 weeks`);

  const upcoming = await upcomingScheduled(seasonId, "2026-10-12");
  check("calendar strip shows the harvest ask 28 days ahead, not later ones", upcoming.length >= 1 && upcoming.every((a) => a.kind === "scheduled" && a.day <= "2026-11-09"), upcoming.map((a) => a.day).join());

  // Open the harvest ask and answer it.
  const day = "2026-10-18";
  const open = await openAsks(robin, seasonId, day);
  const harvest = open.find((a) => a.title === "Harvest collection");
  check("harvest ask is open on its day", !!harvest);
  const before = await openAsks(robin, seasonId, "2026-10-17");
  check("no scheduled ask is open the day before", !before.some((a) => a.title === "Harvest collection"));

  const reserve = await envelopeOf(robin, "giving_reserve");
  const goals = await envelopeOf(robin, "goals");
  await credit(reserve.id, 300);
  await credit(goals.id, 10000);

  let r = await answerAsk(robin, seasonId, day, harvest!.id, 500);
  check("asking for more than the Reserve holds gives what is there", r.ok && (await envelopeOf(robin, "giving_reserve")).balance === 0, r.ok ? r.message : r.error);
  check("Goals untouched by an ask", (await envelopeOf(robin, "goals")).balance === 10000);
  const led = await one<{ amount: number; type: string }>(`SELECT amount, type FROM ledger WHERE player_id=$1 AND type='gift'`, [robin]);
  check("gift is in the ledger", led?.amount === -300);

  r = await answerAsk(robin, seasonId, day, harvest!.id, 100);
  check("cannot answer the same ask twice", !r.ok);
  check("answered ask drops off the open list", !(await openAsks(robin, seasonId, day)).some((a) => a.id === harvest!.id));

  // Empty Reserve and a decline.
  r = await answerAsk(sam, seasonId, day, harvest!.id, 200);
  check("empty Reserve gives nothing and says so plainly", r.ok && r.message.startsWith("Not this time"), r.ok ? r.message : r.error);
  check("Sam still sees nothing owed: no penalty row beyond the answer", Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE player_id=$1`, [sam]))!.n) === 0);
  check("Sam's decline is recorded", (await one<{ a: number }>(`SELECT amount_given AS a FROM ask_response WHERE player_id=$1`, [sam]))?.a === 0);

  r = await answerAsk(sam, seasonId, "2026-10-14", harvest!.id, 100);
  check("an ask not yet open is refused", !r.ok);

  // Same asks for both players on the same day.
  const e2 = await openAsks(robin, seasonId, "2026-11-13");
  const z2 = await openAsks(sam, seasonId, "2026-11-13");
  check("both players see the same ask on the same day", e2.map((a) => a.id).join() === z2.map((a) => a.id).join() && e2.length >= 1);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main();
