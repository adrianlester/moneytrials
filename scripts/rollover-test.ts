/**
 * Day-rollover check against a throwaway PGlite already seeded by hustle-test.ts.
 * Run: PGLITE_DIR=$TEMP/hustle-test npx tsx --conditions=react-server scripts/rollover-test.ts
 */
import { q, one } from "../src/lib/db";
import { rolloverAll, takeNotices } from "../src/lib/rollover";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const robin = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Robin'`))!.id;
  const day = "2026-10-06";
  const week = (await one<{ id: string }>(`SELECT id FROM week WHERE opens_at <= $1 AND closes_at >= $1`, [day]))!.id;

  // An extra shift that fell due today and has not been resolved by anyone.
  await q(
    `INSERT INTO evening_plan (player_id, week_id, slot, day, kind, earned) VALUES ($1,$2,4,$3,'shift',2200)`,
    [robin, week, day],
  );

  const r1 = await rolloverAll(day);
  check("run 1 covers both players", r1.players === 2, JSON.stringify(r1));
  check("run 1 produced the shift notice", r1.notices >= 1);

  const cards = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM event_inst WHERE day = $1`, [day]);
  check("today's card was dealt to both", Number(cards?.n) === 2);

  const banked = await one<{ t: string | number }>(
    `SELECT COALESCE(SUM(amount),0) AS t FROM ledger WHERE player_id=$1 AND note='Extra shift'`, [robin]);
  check("shift banked once", Number(banked?.t) === 2200);

  const r2 = await rolloverAll(day);
  check("run 2 adds nothing", r2.notices === 0, JSON.stringify(r2));
  const banked2 = await one<{ t: string | number }>(
    `SELECT COALESCE(SUM(amount),0) AS t FROM ledger WHERE player_id=$1 AND note='Extra shift'`, [robin]);
  check("shift still banked once", Number(banked2?.t) === 2200);
  const cards2 = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM event_inst WHERE day = $1`, [day]);
  check("no second card dealt", Number(cards2?.n) === 2);

  const seen = await takeNotices(robin);
  check("notice waits for the player", seen.length >= 1 && seen.some((t) => t.includes("Extra shift")), seen.join(" | "));
  check("notice shown once only", (await takeNotices(robin)).length === 0);

  // A day after the season ends does nothing and does not throw.
  const late = await rolloverAll("2027-06-01");
  check("outside the season is a no-op", late.notices === 0);
  const results = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM week_result WHERE player_id=$1`, [robin]);
  check("every week, including the last, got a result", Number(results?.n) === 12, `${results?.n} results`);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
