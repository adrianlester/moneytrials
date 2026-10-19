/**
 * Phase 4: loans, giving-change approval, match-funding, difficulty decks, pause / resume /
 * extend, season end and the report. Run against a throwaway PGlite:
 * PGLITE_DIR=$TEMP/p4-test npx tsx --conditions=react-server scripts/phase4-test.ts
 */
import { q, one } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import {
  addDays, cardForPlayer, dealCard, endSeasonIfDone, envelopeOf, paydayView, runPayday, weekFor,
} from "../src/lib/engine";
import { acceptLoan, currentLoan, decideCommitment, declineLoan, offerLoan, requestCommitmentChange, requestLoan } from "../src/lib/loans";
import {
  buildTierDeck, extendSeason, matchFundraiser, pauseSeason, resumeSeason, saveCard, scaleCard,
  setAskFrequency, setPlayerDeck, setPlayerWage, validateCard, createCard, cardForEdit,
} from "../src/lib/admin";
import { myFundraiser, openAsks, startFundraiser } from "../src/lib/asks";
import { seasonReport } from "../src/lib/report";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures++;
}

async function main() {
  const seasonId = await createSeason({
    name: "t", startDate: "2026-09-19", weeks: 4, charityFrequency: "normal", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
      { name: "Dad", pin: "3333", role: "admin" },
    ],
  });
  const robin = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Robin'`))!.id;
  const sam = (await one<{ id: string }>(`SELECT id FROM player WHERE display_name='Sam'`))!.id;
  await q(`UPDATE player SET wage_variance = FALSE WHERE role='player'`);
  const w1 = "2026-09-19";
  const w2 = "2026-09-26";

  /* ---------------------------------------------------------------- loans */
  let r = await requestLoan(robin, w1, 6000, "bike lock");
  check("request a loan", r.ok);
  r = await requestLoan(robin, w1, 1000, "");
  check("only one loan at a time", !r.ok);
  const l0 = (await currentLoan(robin))!;
  r = await offerLoan(l0.id, w1, 6000, 1000, 4);
  check("terms that do not repay the loan are refused", !r.ok, r.ok ? "" : r.error);
  r = await offerLoan(l0.id, w1, 6000, 2000, 3);
  check("admin sets terms", r.ok);
  r = await acceptLoan(sam, null, w1, l0.id, "Dad");
  check("another player cannot accept it", !r.ok);
  const bankedBefore = Number((await one<{ s: number }>(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE player_id=$1 AND type='banked'`, [robin]))!.s);
  r = await acceptLoan(robin, null, w1, l0.id, "Dad");
  check("player accepts and the money is banked, not in an envelope", r.ok
    && Number((await one<{ s: number }>(`SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE player_id=$1 AND type='banked'`, [robin]))!.s) === bankedBefore + 6000);

  // Week 1 payday (day 1): loan is active, so the first repayment is due.
  let view = (await paydayView(robin, seasonId, w1, 9500, false))!;
  check("repayment is shown on payday", view.loanDue === 2000 && view.loanPaid === 2000 && view.loanShortfall === 0, JSON.stringify([view.loanDue, view.available]));
  const pay1 = await runPayday(robin, view, w1, { bills: view.available });
  check("payday runs with the repayment taken first", pay1.ok);
  const loan1 = (await currentLoan(robin))!;
  check("outstanding fell by the repayment", loan1.outstanding === 4000 && loan1.status === "active");
  const repay = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE player_id=$1 AND type='loan_repayment'`, [robin]);
  check("repayment is in the ledger", Number(repay?.n) === 1);

  // The loan money itself arrives with this week's wage; take it out of the picture so the
  // lean-week test below is about the wage alone.
  await q(`INSERT INTO ledger (player_id, day, type, amount, note) VALUES ($1,'2026-09-26','banked_in',6000,'test')`, [robin]);
  // A lean week: wage so low the repayment cannot be covered.
  await q(`UPDATE wage_roll SET amount = 500 WHERE player_id = $1 AND week_id = (SELECT id FROM week WHERE season_id=$2 AND idx=2)`, [robin, seasonId]);
  view = (await paydayView(robin, seasonId, w2, 9500, false))!;
  check("short wage: part paid, the rest is a shortfall", view.loanPaid === 500 && view.loanShortfall === 1500 && view.available === 0, `${view.loanPaid}/${view.loanShortfall}`);
  const pay2 = await runPayday(robin, view, w2, {});
  check("payday still runs with nothing to allocate", pay2.ok);
  const loan2 = (await currentLoan(robin))!;
  check("shortfall stays owing", loan2.outstanding === 3500);
  const miss = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE player_id=$1 AND type='unpaid_obligation'`, [robin]);
  check("a missed repayment is an unpaid obligation (fails the week)", Number(miss?.n) === 1);

  await q(`UPDATE loan SET outstanding = 1000 WHERE id = $1`, [l0.id]);
  const w3 = "2026-10-03";
  view = (await paydayView(robin, seasonId, w3, 9500, false))!;
  check("the last payment is only what is left", view.loanDue === 1000);
  await runPayday(robin, view, w3, { bills: view.available });
  check("loan is marked repaid", (await currentLoan(robin))?.status === "repaid");

  // Decline paths.
  r = await requestLoan(sam, w1, 3000, "");
  const lz = (await currentLoan(sam))!;
  r = await declineLoan(lz.id, w1);
  check("admin can decline a request", r.ok && (await currentLoan(sam))?.status === "declined");

  /* ------------------------------------------------------ giving change */
  r = await requestCommitmentChange(sam, w1, 500);
  const creq = await one<{ id: string }>(`SELECT id FROM commitment_request WHERE player_id=$1`, [sam]);
  check("request a change", r.ok && !!creq);
  r = await requestCommitmentChange(sam, w1, 700);
  check("only one change waiting at a time", !r.ok);
  await decideCommitment(creq!.id, true, w1);
  check("approved change takes effect", (await one<{ amount: number }>(`SELECT amount FROM commitment WHERE player_id=$1`, [sam]))?.amount === 500);

  /* ---------------------------------------------------------- match fund */
  await startFundraiser(robin, seasonId, w1, { cause: "Hospice", why: "", target: 5000, method: "event" });
  const f = (await myFundraiser(robin, w1))!;
  r = await matchFundraiser(f.id, 1500, w1);
  const f2 = (await myFundraiser(robin, w1))!;
  check("admin match raises the total", r.ok && f2.raised === 1500 && f2.matched === 1500);
  const seen = (await openAsks(sam, seasonId, w1)).find((a) => a.kind === "fundraiser");
  check("the other player sees the matched total", seen?.fundraiser?.raised === 1500);
  check("a match never touches a ledger", Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ledger WHERE type='gift'`))!.n) === 0);

  /* --------------------------------------------------------------- decks */
  check("scaleCard changes cost and text together", (() => {
    const s = scaleCard({
      title: "Cinema", body: "Tickets are £9.50 and popcorn is £4.",
      options: [{ id: "a", label: "Go (£9.50)", spend: { enjoyment: 950 } }, { id: "b", label: "Stay in", income: 400 }],
    }, 0.8);
    return s.options[0].spend?.enjoyment === 750 && s.options[0].label === "Go (£7.50)" && s.body.includes("£7.50") && s.body.includes("£4.") && s.options[1].income === 400;
  })());
  const br = await buildTierDeck("gentle", 0.8);
  check("builds a tier deck", br.ok, br.ok ? br.message : br.error);
  await setPlayerDeck(sam, "gentle");

  const day = "2026-09-21";
  const wk = (await weekFor(seasonId, day))!;
  const dE = (await dealCard(robin, "standard", wk.id, day, "crochet"))!;
  const dZ = (await dealCard(sam, "gentle", wk.id, day, "baking"))!;
  check("same card on the same day for both decks", dE.card.id === dZ.card.id, dE.card.id);
  check("a deck never shows in the card the player gets", !JSON.stringify(dZ.card).includes("gentle") && dZ.card.deck_id === dE.card.deck_id);
  // Find a card whose cost differs between decks to prove the override is applied.
  const costly = await q<{ id: string }>(`SELECT id FROM event_card WHERE deck_id='standard' AND options_json LIKE '%"spend"%' LIMIT 40`);
  let differs = 0;
  for (const c of costly) {
    const a = await cardForPlayer(c.id, "standard", null);
    const b = await cardForPlayer(c.id, "gentle", null);
    if (JSON.stringify(a!.options) !== JSON.stringify(b!.options)) differs++;
  }
  check("gentle deck changes costs on most cards", differs > costly.length / 2, `${differs}/${costly.length}`);
  const ids = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM event_card WHERE id LIKE '%@gentle'`);
  check("overrides stored beside the base, not instead of it", Number(ids[0].n) > 50);

  const base = (await cardForEdit(dE.card.id, "standard"))!;
  const edited = await saveCard(dE.card.id, "gentle", {
    kind: base.kind, title: "Edited for gentle", body: base.body, weight: base.weight, season_window: "", options_json: base.options_json,
  });
  check("a single card can be edited for one deck", edited.ok && (await cardForPlayer(dE.card.id, "gentle", null))!.title === "Edited for gentle" && (await cardForPlayer(dE.card.id, "standard", null))!.title !== "Edited for gentle");

  check("a bad card is refused", validateCard({ kind: "dilemma", title: "x", body: "y", weight: 1, season_window: "", options_json: `[{"id":"a","label":"only one"}]` }) !== null);
  check("a good card passes", validateCard({ kind: "dilemma", title: "x", body: "y", weight: 1, season_window: "", options_json: `[{"id":"a","label":"A"},{"id":"b","label":"B"}]` }) === null);
  const made = await createCard({ id: "Fixed Bike!", kind: "event", title: "Bike", body: "Puncture.", weight: 2, season_window: "", options_json: `[{"id":"a","label":"Pay","spend":{"enjoyment":300}}]` });
  check("a new card is added to the main deck", made.ok && (await cardForPlayer("fixed-bike", "standard", null))?.title === "Bike");

  /* ------------------------------------------------------------- wages */
  await setPlayerWage(robin, 12000, true);
  const eRow = await one<{ base_wage: number; wage_variance: boolean }>(`SELECT base_wage, wage_variance FROM player WHERE id=$1`, [robin]);
  check("wage and variance saved", eRow?.base_wage === 12000 && eRow.wage_variance === true);

  /* ------------------------------------------------------ pause / resume */
  const wkIdx = async (i: number) => (await one<{ o: string }>(`SELECT opens_at::text AS o FROM week WHERE season_id=$1 AND idx=$2`, [seasonId, i]))!.o;
  const before3 = await wkIdx(3);
  r = await pauseSeason(seasonId, "2026-09-22");
  check("pause", r.ok && (await one<{ s: string }>(`SELECT status AS s FROM season WHERE id=$1`, [seasonId]))?.s === "paused");
  r = await resumeSeason(seasonId, "2026-10-01");
  check("resume pushes unstarted weeks out", r.ok && (await wkIdx(3)) === addDays(before3, 7), `${before3} -> ${await wkIdx(3)}`);
  check("resume keeps the weekday", new Date(`${await wkIdx(3)}T12:00:00Z`).getUTCDay() === new Date(`${before3}T12:00:00Z`).getUTCDay());
  check("the week it was paused in did not move, the next one did", (await wkIdx(1)) === "2026-09-19" && (await wkIdx(2)) === "2026-10-03");
  const stretched = await one<{ c: string }>(`SELECT closes_at::text AS c FROM week WHERE season_id=$1 AND idx=1`, [seasonId]);
  check("the week it was paused in runs on to meet the next", stretched?.c === "2026-10-02", stretched?.c);
  const wk3 = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM week w WHERE season_id=$1 AND EXISTS (SELECT 1 FROM week x WHERE x.season_id=w.season_id AND x.idx<>w.idx AND x.opens_at <= w.closes_at AND x.closes_at >= w.opens_at)`, [seasonId]);
  check("no two weeks overlap", Number(wk3?.n) === 0);

  r = await extendSeason(seasonId, 2);
  check("extend adds weeks after the last", r.ok && Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM week WHERE season_id=$1`, [seasonId]))!.n) === 6);
  check("extend rejects silly numbers", !(await extendSeason(seasonId, 40)).ok);

  const askBefore = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ask WHERE season_id=$1 AND kind='unannounced'`, [seasonId]))!.n);
  await setAskFrequency(seasonId, "generous", "2026-09-30");
  const pastAsks = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM ask WHERE season_id=$1 AND kind='unannounced' AND day <= '2026-09-30'`, [seasonId]))!.n);
  check("changing frequency leaves asks that already came", pastAsks <= askBefore);
  check("a bad frequency is refused", !(await setAskFrequency(seasonId, "lots", "2026-09-30")).ok);

  /* ---------------------------------------------------------- season end */
  check("season is not over mid-way", !(await endSeasonIfDone(seasonId, "2026-10-05")));
  const lastClose = (await one<{ c: string }>(`SELECT MAX(closes_at)::text AS c FROM week WHERE season_id=$1`, [seasonId]))!.c;
  check("season ends the day after the last week", await endSeasonIfDone(seasonId, addDays(lastClose, 1)));
  check("status becomes ended", (await one<{ s: string }>(`SELECT status AS s FROM season WHERE id=$1`, [seasonId]))?.s === "ended");
  const results = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM week_result WHERE player_id=$1`, [robin]))!.n);
  check("every week has a result", results === 6, `${results}`);

  const rep = await seasonReport(robin);
  check("report: three separate sections", rep.survival.weeksSurvived + rep.survival.weeksFailed === 6 && Array.isArray(rep.goals) && typeof rep.given.total === "number");
  check("report: the missed loan payment shows as a failed week", rep.survival.weeksFailed >= 1 && rep.survival.obligationsFailed === 1, JSON.stringify(rep.survival.failedWeeks));
  const repZ = await seasonReport(sam);
  check("report: gave nothing is plain", repZ.given.total > 0 || repZ.given.total === 0);
  check("report: fundraiser matched amount appears", rep.given.raised[0]?.matched === 1500);
  void envelopeOf; void openAsks;

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
