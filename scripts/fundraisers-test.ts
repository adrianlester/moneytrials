/**
 * Player fundraisers. Run against a throwaway PGlite:
 * PGLITE_DIR=$TEMP/fund-test npx tsx --conditions=react-server scripts/fundraisers-test.ts
 */
import { q, one } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import { credit, envelopeOf } from "../src/lib/engine";
import { answerAsk, myFundraiser, openAsks, startFundraiser } from "../src/lib/asks";
import { decideSales } from "../src/lib/hustle";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const seasonId = await createSeason({
    name: "t", startDate: "2026-10-12", weeks: 12, charityFrequency: "sparse", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
    ],
  });
  const robin = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Robin'`))!.id;
  const sam = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Sam'`))!.id;
  const day = "2026-10-13";
  await credit((await envelopeOf(sam, "giving_reserve")).id, 700);
  await credit((await envelopeOf(robin, "giving_reserve")).id, 900);

  let r = await startFundraiser(robin, seasonId, day, { cause: "", why: "", target: 5000, method: "event" });
  check("needs a cause", !r.ok);
  r = await startFundraiser(robin, seasonId, day, { cause: "Air ambulance", why: "5k at Scrabo", target: 0, method: "event" });
  check("needs a target", !r.ok);
  r = await startFundraiser(robin, seasonId, day, { cause: "Air ambulance", why: "5k at Scrabo", target: 5000, method: "event" });
  check("starts a fundraiser", r.ok, r.ok ? r.message : r.error);
  r = await startFundraiser(robin, seasonId, day, { cause: "Another", why: "", target: 1000, method: "sales" });
  check("only one at a time", !r.ok);

  const mine = await openAsks(robin, seasonId, day);
  check("the owner is not asked to sponsor her own", !mine.some((a) => a.kind === "fundraiser"));
  const theirs = (await openAsks(sam, seasonId, day)).find((a) => a.kind === "fundraiser");
  check("the other player gets it as a card", !!theirs && theirs.fundraiser?.by === "Robin" && theirs.fundraiser.target === 5000);

  const eBefore = (await envelopeOf(robin, "giving_reserve")).balance;
  r = await answerAsk(sam, seasonId, day, theirs!.id, 200);
  check("sponsoring comes from Sam's Reserve", r.ok && (await envelopeOf(sam, "giving_reserve")).balance === 500);
  check("the owner's money never moves", (await envelopeOf(robin, "giving_reserve")).balance === eBefore);

  const f = await myFundraiser(robin, day);
  check("raised total and sponsor list update", f?.raised === 200 && f.sponsors[0]?.name === "Sam" && f.open);
  check("it closes after a week", !(await myFundraiser(robin, "2026-10-21"))!.open);

  r = await startFundraiser(robin, seasonId, "2026-10-21", { cause: "Hospice", why: "", target: 3000, method: "sales" });
  check("a new one can start once the last has closed", r.ok);
  const led = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE player_id=$1 AND type='gift'`, [sam]);
  check("one gift in Sam's ledger", Number(led?.n) === 1);

  // Sales method: a sale can go straight to the fundraiser and counts toward the total.
  const mk = await one<{ id: string }>(
    `INSERT INTO market_day (player_id, day, band) VALUES ($1,'2026-10-24','fair') RETURNING id`, [robin],
  );
  await q(
    `INSERT INTO stock_item (player_id, item, price, made_on, status, market_id) VALUES ($1,'scrunchie',600,'2026-10-20','sold',$2), ($1,'scrunchie',400,'2026-10-20','sold',$2)`,
    [robin, mk!.id],
  );
  const sales = await q<{ id: string }>(`SELECT id FROM stock_item WHERE player_id=$1 AND status='sold' ORDER BY price DESC`, [robin]);
  const resBefore = (await envelopeOf(robin, "giving_reserve")).balance;
  const d = await decideSales(robin, null, { [sales[0].id]: "fundraiser", [sales[1].id]: "me" }, "2026-10-24");
  check("one sale to the fundraiser, one kept", d.raised === 600 && d.kept === 400);
  const f2 = await myFundraiser(robin, "2026-10-22");
  check("the sale counts toward the total", f2?.raised === 600 && f2.fromSales === 600, `${f2?.raised}`);
  check("no envelope moved", (await envelopeOf(robin, "giving_reserve")).balance === resBefore);
  const net = await one<{ s: number }>(`SELECT SUM(amount) AS s FROM ledger WHERE player_id=$1 AND type IN ('sale_to_fundraiser','gift')`, [robin]);
  check("ledger nets to zero for the fundraiser sale", Number(net?.s) === 0);
  const ownGift = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE player_id=$1 AND type='gift'`, [robin]);
  check("it is recorded as a gift", Number(ownGift?.n) === 1);
  const seen = (await openAsks(sam, seasonId, "2026-10-22")).find((a) => a.kind === "fundraiser");
  check("the other player sees the sales in the raised figure", seen?.fundraiser?.raised === 600, `${seen?.fundraiser?.raised}`);
  const refused = await decideSales(robin, null, {}, "2026-10-24");
  check("nothing pending, nothing happens", refused.raised === 0);

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main();
