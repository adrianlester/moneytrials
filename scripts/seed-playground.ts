/**
 * A playground season with three weeks of history, for looking at the app with something in it.
 * Plays Robin (careful) and Sam (mixed) through the real engine from Sat 19 Sep to Sun 11 Oct,
 * answering any asks on the way. Today (Mon 12 Oct) is left untouched, and Sam has not done
 * week 4's payday, so that form is still there to try.
 *
 * Test logins, throwaway data only:  Robin 1111 | Sam 2222 | Dad (admin) 3333
 * Sam has asked to change her Committed Giving, so the admin has one thing waiting.
 *
 * Run (PGLITE_DIR must point at an empty folder):
 *   $env:PGLITE_DIR = "$env:TEMP\moneytrials-playground"
 *   npx tsx --conditions=react-server scripts/seed-playground.ts
 */
import { q } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import {
  addDays, addGoal, buyGoal, dealCard, isoDate, paydayView, planEvenings, resolveCard, rng, runPayday,
  syncGoalsEnvelope, type CardOption, type WeekRow,
} from "../src/lib/engine";
import { rolloverPlayer } from "../src/lib/rollover";
import { craftRule, itemOf } from "../src/lib/hustle-data";
import {
  availableMakingEvenings, buySupplies, decideSales, makeOn, pendingSales, projectOf, suppliesOf,
} from "../src/lib/hustle";
import { answerAsk, openAsks } from "../src/lib/asks";
import { requestCommitmentChange } from "../src/lib/commitments";
import type { EveningKind } from "../src/lib/evenings";

const START = "2026-09-19"; // a Saturday, so payday is the first day of each week
const LAST_DAY = "2026-10-11";

const STYLE: Record<string, { alloc: { bills: number; enjoyment: number; giving: number }; evenings: EveningKind[]; cheap: boolean }> = {
  Robin: { alloc: { bills: 2000, enjoyment: 2000, giving: 500 }, evenings: ["shift", "shift", "making", "making", "nothing"], cheap: true },
  Sam: { alloc: { bills: 1500, enjoyment: 3500, giving: 500 }, evenings: ["shift", "making", "making", "going_out", "nothing"], cheap: false },
};
const GOALS: Record<string, Array<[string, number]>> = {
  Robin: [["Market stall kit", 30000], ["Inline skates", 16500]],
  Sam: [["Stand mixer", 40000], ["Airbrush set", 10900]],
};

function netCost(o: CardOption): number {
  const spend = Object.values(o.spend ?? {}).reduce((n, v) => n + (v ?? 0), 0);
  return spend + (o.obligation ?? 0) - (o.income ?? 0) + (o.takesEvening ? 1500 : 0);
}

async function main() {
  const seasonId = await createSeason({
    name: "The Money Trials (playground)", startDate: START, weeks: 12, charityFrequency: "generous", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
      { name: "Dad", pin: "3333", role: "admin" },
    ],
  });
  const players = await q<{ id: string; display_name: string; craft: string; base_wage: number; deck_id: string }>(
    `SELECT id, display_name, craft, base_wage, deck_id FROM player WHERE season_id = $1 AND role='player' ORDER BY display_name`,
    [seasonId],
  );
  for (const p of players) {
    for (const [name, price] of GOALS[p.display_name]) {
      await q(`INSERT INTO goal (player_id, name, target_amount) VALUES ($1,$2,$3)`, [p.id, name, price]);
    }
    await q(`UPDATE commitment SET amount = 300 WHERE player_id = $1`, [p.id]);
    await q(`UPDATE player SET setup_done = TRUE WHERE id = $1`, [p.id]);
  }

  const weeks = await q<WeekRow>(`SELECT id, season_id, idx, opens_at, closes_at FROM week WHERE season_id=$1 ORDER BY idx`, [seasonId]);

  for (const w of weeks) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(isoDate(w.opens_at), d);
      if (day > LAST_DAY) break;
      for (const p of players) {
        // Sam has not been in since the end of week 3.
        if (p.display_name === "Sam" && w.idx === 4) continue;
        const S = STYLE[p.display_name];
        const craft = craftRule(p.craft)!;

        if (d === 0) {
          const view = await paydayView(p.id, seasonId, day, p.base_wage, true);
          if (view && !view.alreadyAllocated) {
            const a = S.alloc;
            const bills = Math.min(a.bills, view.available);
            const enj = Math.min(a.enjoyment, view.available - bills);
            const giv = Math.min(a.giving, view.available - bills - enj);
            const goals = view.available - bills - enj - giv;
            const pay = await runPayday(p.id, view, day, { bills, enjoyment: enj, giving_reserve: giv, goals });
            if (!pay.ok) throw new Error(pay.error);
            const ev = await planEvenings(p.id, view.week, S.evenings);
            if (!ev.ok) throw new Error(ev.error);
          }
        }

        await rolloverPlayer(
          { id: p.id, display_name: p.display_name, season_id: seasonId, craft: p.craft, deck_id: p.deck_id, payday_weekday: 6 },
          day,
        );

        const dealt = await dealCard(p.id, p.deck_id, w.id, day, p.craft);
        if (dealt && !dealt.inst.choice) {
          const opts = dealt.card.options;
          const pick = S.cheap
            ? [...opts].sort((a, b) => netCost(a) - netCost(b))[0]
            : opts[Math.floor(rng(`pick:${p.id}:${day}`)() * opts.length)];
          await resolveCard(p.id, w.id, day, dealt.inst.id, dealt.card, pick.id);
        }

        // Asks: Robin gives a pound or two, Sam says not this time about half the time.
        for (const a of await openAsks(p.id, seasonId, day)) {
          const give = p.display_name === "Robin" ? a.suggested[0] : rng(`ask:${p.id}:${a.id}`)() < 0.5 ? 0 : a.suggested[0];
          await answerAsk(p.id, seasonId, day, a.id, give);
        }

        for (const ev of await availableMakingEvenings(p.id)) {
          const project = await projectOf(p.id);
          const r = rng(`make:${p.id}:${ev.id}`)();
          const total = craft.items.reduce((n, i) => n + i.appeal, 0);
          let t = r * total;
          let item = craft.items[craft.items.length - 1];
          for (const i of craft.items) { t -= i.appeal; if (t <= 0) { item = i; break; } }
          if (project) item = itemOf(craft, project.item)!;
          if (!project && (await suppliesOf(p.id)) < item.batches) {
            const bought = await buySupplies(p.id, w.id, day, craft, item.batches - (await suppliesOf(p.id)));
            if (!bought.ok) continue;
          }
          await makeOn(p.id, craft, ev.id, item.key);
        }
        const pending = await pendingSales(p.id);
        if (pending.length) {
          const dec: Record<string, "me" | "giving"> = {};
          pending.forEach((s) => { dec[s.id] = rng(`dest:${s.id}`)() < 0.3 ? "giving" : "me"; });
          await decideSales(p.id, w.id, dec);
        }
        await syncGoalsEnvelope(p.id);
        for (const g of await q<{ id: string; saved_amount: number; target_amount: number }>(
          `SELECT id, saved_amount, target_amount FROM goal WHERE player_id=$1 AND bought_at IS NULL ORDER BY created_at`, [p.id],
        )) {
          if (g.saved_amount >= g.target_amount && (await buyGoal(p.id, w.id, day, g.id)).ok) {
            await addGoal(p.id, "Next thing", 12000);
          }
        }
      }
    }
  }

  // Something waiting for the admin to decide.
  const robinId = players.find((p) => p.display_name === "Robin")!.id;
  const samId = players.find((p) => p.display_name === "Sam")!.id;
  await requestCommitmentChange(samId, LAST_DAY, 500);

  const n = async (sql: string) => Number((await q<{ n: number }>(sql))[0].n);
  console.log("ledger rows:", await n("SELECT COUNT(*) AS n FROM ledger"));
  console.log("cards answered:", await n("SELECT COUNT(*) AS n FROM event_inst WHERE choice IS NOT NULL"));
  console.log("asks answered:", await n("SELECT COUNT(*) AS n FROM ask_response"), "of", await n(`SELECT COUNT(*) AS n FROM ask WHERE day <= '${LAST_DAY}'`));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
