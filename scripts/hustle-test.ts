/**
 * End-to-end check of the side hustle against a throwaway PGlite database.
 * Run: PGLITE_DIR=$TEMP/hustle-test npx tsx --conditions=react-server scripts/hustle-test.ts
 */
import { q, one } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import { envelopeOf, post, weekFor } from "../src/lib/engine";
import { craftRule } from "../src/lib/hustle-data";
import {
  availableMakingEvenings, buySupplies, decideSales, makeOn, pendingSales,
  recentMarkets, resolveMarkets, stockCounts, suppliesOf,
} from "../src/lib/hustle";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  // Saturday 5 Sep 2026 start, payday and market on Saturdays.
  const seasonId = await createSeason({
    name: "test", startDate: "2026-09-05", weeks: 12, charityFrequency: "normal", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
    ],
  });
  const robin = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Robin'`))!.id;
  const sam = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Sam'`))!.id;
  const crochet = craftRule("crochet")!;
  const baking = craftRule("baking")!;
  const week1 = (await weekFor(seasonId, "2026-09-05"))!;

  // Fund Goals so supplies can be bought: £50 allocated.
  const goals = await envelopeOf(robin, "goals");
  await q(`UPDATE envelope SET balance = 5000 WHERE id = $1`, [goals.id]);

  // 1. Buying supplies.
  let r = await buySupplies(robin, week1.id, "2026-09-05", crochet, 2);
  check("buy 2 batches", r.ok && (await suppliesOf(robin)) === 2);
  check("paid from Goals", (await envelopeOf(robin, "goals")).balance === 5000 - 2400);
  r = await buySupplies(robin, week1.id, "2026-09-05", crochet, 10);
  check("cannot buy what you cannot afford", !r.ok, r.ok ? "" : r.error);

  // Two making evenings, already resolved, on Sat 5 and Sun 6 Sep.
  for (const [slot, day] of [[1, "2026-09-05"], [2, "2026-09-06"], [3, "2026-09-07"]] as const) {
    await q(
      `INSERT INTO evening_plan (player_id, week_id, slot, day, kind, resolved_at) VALUES ($1,$2,$3,$4,'making', now())`,
      [robin, week1.id, slot, day],
    );
  }
  let evs = await availableMakingEvenings(robin);
  check("three making evenings available", evs.length === 3);

  // 2. A one-evening item and a two-evening item.
  r = await makeOn(robin, crochet, evs[0].id, "scrunchie");
  check("scrunchies made", r.ok && (await stockCounts(robin)).scrunchie === 6, r.ok ? r.message : r.error);
  check("one batch used", (await suppliesOf(robin)) === 1);
  evs = await availableMakingEvenings(robin);
  check("evening spent", evs.length === 2);

  r = await makeOn(robin, crochet, evs[0].id, "hat");
  check("hat run starts, not finished", r.ok && !(await stockCounts(robin)).hat, r.ok ? r.message : r.error);
  r = await makeOn(robin, crochet, evs[1].id, "scrunchie");
  check("cannot switch item mid-project", !r.ok, r.ok ? "" : r.error);
  evs = await availableMakingEvenings(robin);
  r = await makeOn(robin, crochet, evs[0].id, "hat");
  check("hat run finishes with 3 hats", r.ok && (await stockCounts(robin)).hat === 3, r.ok ? r.message : r.error);
  r = await makeOn(robin, crochet, "00000000-0000-0000-0000-000000000000", "hat");
  check("cannot make on an evening that is not yours", !r.ok);
  check("no batches left", (await suppliesOf(robin)) === 0);

  // 3. Markets resolve, and are deterministic.
  const notes = await resolveMarkets(robin, crochet, seasonId, 6, "2026-10-03");
  const markets = await recentMarkets(robin, 20);
  check("market days resolved on each Saturday to 3 Oct", markets.length === 5, `${markets.length} markets`);
  const sold = markets.reduce((n, m) => n + m.sold, 0);
  const left = Object.values(await stockCounts(robin)).reduce((n, v) => n + v, 0);
  check("sold + remaining = 9 made", sold + left === 9, `${sold} sold, ${left} left`);
  const again = await resolveMarkets(robin, crochet, seasonId, 6, "2026-10-03");
  check("running it again changes nothing", again.length === 0);
  console.log("   ", notes.join("\n    "));
  console.log("    markets:", markets.map((m) => `${m.day} ${m.band} cap${m.capacity} sold${m.sold} £${m.revenue / 100}`).join(" | "));

  // 4. Shared demand: Sam's markets use the same bands on the same days.
  await resolveMarkets(sam, baking, seasonId, 6, "2026-10-03");
  const zm = await recentMarkets(sam, 20);
  check("both players see the same demand", JSON.stringify(zm.map((m) => m.band)) === JSON.stringify(markets.map((m) => m.band)));

  // 5. The decision, one sale at a time.
  const pending = await pendingSales(robin);
  check("sales wait on a decision", pending.length === sold && pending.length > 0, `${pending.length} pending`);
  const giving = await envelopeOf(robin, "giving_reserve");
  const decisions: Record<string, "me" | "giving"> = {};
  pending.forEach((s, i) => { decisions[s.id] = i % 2 === 0 ? "me" : "giving"; });
  const res = await decideSales(robin, week1.id, decisions);
  const toGive = pending.filter((_, i) => i % 2 === 1).reduce((n, s) => n + s.price, 0);
  const toKeep = pending.filter((_, i) => i % 2 === 0).reduce((n, s) => n + s.price, 0);
  check("kept and given totals", res.kept === toKeep && res.given === toGive, `kept ${res.kept}, given ${res.given}`);
  check("giving went into the Giving Reserve", (await envelopeOf(robin, "giving_reserve")).balance === giving.balance + toGive);
  check("nothing left pending", (await pendingSales(robin)).length === 0);
  const banked = await one<{ t: string | number }>(
    `SELECT COALESCE(SUM(amount),0) AS t FROM ledger WHERE player_id=$1 AND type='banked'`, [robin]);
  check("kept money is banked in the ledger", Number(banked?.t) === toKeep);
  const again2 = await decideSales(robin, week1.id, decisions);
  check("deciding twice pays nothing twice", again2.kept === 0 && again2.given === 0);

  // 6. Stock made after a market day cannot sell at it.
  await q(`INSERT INTO stock_item (player_id, item, price, made_on) VALUES ($1,'cookies',300,'2026-10-20')`, [sam]);
  await resolveMarkets(sam, baking, seasonId, 6, "2026-10-17");
  const cookiesSold = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM stock_item WHERE player_id=$1 AND status='sold'`, [sam]);
  check("later stock is not sold by an earlier market", Number(cookiesSold?.n) === 0);

  // 7. A grant of supplies from a card option is additive.
  await q(`INSERT INTO hustle_supply (player_id, batches) VALUES ($1,1)`, [sam]);
  await q(`INSERT INTO hustle_supply (player_id, batches) VALUES ($1,3) ON CONFLICT (player_id) DO UPDATE SET batches = hustle_supply.batches + EXCLUDED.batches`, [sam]);
  check("card supplies are additive", (await suppliesOf(sam)) === 4);

  // 8. Every craft the setup screen offers has a menu.
  check("all four crafts exist", ["crochet", "baking", "art", "jewellery"].every((c) => craftRule(c) !== null));
  check("a made-up craft is refused", craftRule("pottery") === null);

  // 9. A booked market adds a day and busies it.
  await q(`INSERT INTO extra_market (player_id, day, boost, source) VALUES ($1,'2026-10-14',150,'School fair')`, [sam]);
  await q(`INSERT INTO stock_item (player_id, item, price, made_on) SELECT $1,'cookies',300,'2026-10-10' FROM generate_series(1,12)`, [sam]);
  await resolveMarkets(sam, baking, seasonId, 6, "2026-10-14");
  const extra = (await recentMarkets(sam, 30)).find((m) => m.day === "2026-10-14");
  check("an extra market day was resolved", !!extra, extra ? `${extra.band} cap${extra.capacity}` : "");
  const factor = ({ dead: 0, quiet: 0.5, fair: 1, busy: 1.6 } as Record<string, number>)[extra?.band ?? "fair"];
  check("its capacity carries the boost", !!extra && extra.capacity === Math.round(Math.round(6 * factor) * 1.5), `got ${extra?.capacity}`);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
