/**
 * Plays whole seasons through the REAL engine (cards, payday, evenings, hustle,
 * markets, rollover) with bot players, to see how the numbers actually land.
 * Unlike season-sim.mjs this is not a model of the rules; it runs them.
 *
 * Run: PGLITE_DIR=$TEMP/play npx tsx --conditions=react-server scripts/play-season.ts
 * Options: --reps 3
 */
import { q, one } from "../src/lib/db";
import { createSeason } from "../src/lib/seed";
import {
  addDays, addGoal, buyGoal, dealCard, envelopeOf, isoDate, paydayView, planEvenings, resolveCard, resolveWeek, rng, runPayday,
  syncGoalsEnvelope, weekFor, type CardOption, type WeekRow,
} from "../src/lib/engine";
import { rolloverPlayer } from "../src/lib/rollover";
import { craftRule, itemOf } from "../src/lib/hustle-data";
import {
  availableMakingEvenings, buySupplies, decideSales, makeOn, pendingSales, projectOf, suppliesOf,
} from "../src/lib/hustle";
import type { EveningKind } from "../src/lib/evenings";

type Style = "careful" | "mixed" | "spendy";

const STYLES: Record<Style, { alloc: { bills: number; enjoyment: number; giving: number }; evenings: EveningKind[]; cards: "cheapest" | "random" | "dearest"; hustle: boolean }> = {
  careful: { alloc: { bills: 2000, enjoyment: 2000, giving: 500 }, evenings: ["shift", "shift", "making", "making", "nothing"], cards: "cheapest", hustle: true },
  mixed:   { alloc: { bills: 1500, enjoyment: 3500, giving: 500 }, evenings: ["shift", "making", "making", "going_out", "nothing"], cards: "random", hustle: true },
  spendy:  { alloc: { bills: 1000, enjoyment: 6000, giving: 0 },   evenings: ["shift", "going_out", "going_out", "making", "nothing"], cards: "dearest", hustle: true },
};

const GOALS: Record<string, Array<[string, number]>> = {
  Robin: [["Market stall kit", 22000], ["Inline skates", 16500]],
  Sam: [["Stand mixer", 40000], ["Airbrush set", 10900]],
};

const reps = Number(process.argv[process.argv.indexOf("--reps") + 1]) || 2;

function netCost(o: CardOption): number {
  const spend = Object.values(o.spend ?? {}).reduce((n, v) => n + (v ?? 0), 0);
  return spend + (o.obligation ?? 0) - (o.income ?? 0) + (o.takesEvening ? 1500 : 0);
}

interface Result {
  style: Style; start: string; name: string; craft: string;
  goalsSaved: number; goalsReached: number; goalTotal: number;
  enjoyment: number; given: number; failedWeeks: number; unpaid: number;
  revenue: number; supplies: number; unsold: number; sold: number; made: number;
  bought: number; boughtValue: number;
}

async function playSeason(style: Style, start: string, rep: number): Promise<Result[]> {
  const S = STYLES[style];
  const seasonId = await createSeason({
    name: `${style}-${start}-${rep}`, startDate: start, weeks: 12, charityFrequency: "normal", paydayWeekday: 6,
    players: [
      { name: "Robin", pin: "1111", role: "player", craft: "crochet" },
      { name: "Sam", pin: "2222", role: "player", craft: "baking" },
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
  }

  const stats = new Map(players.map((p) => [p.id, { revenue: 0, supplies: 0, made: 0, bought: 0, boughtValue: 0 }]));
  const weeks = await q<WeekRow>(`SELECT id, season_id, idx, opens_at, closes_at FROM week WHERE season_id=$1 ORDER BY idx`, [seasonId]);

  for (const w of weeks) {
    for (let d = 0; d < 7; d++) {
      const day = addDays(isoDate(w.opens_at), d);
      for (const p of players) {
        const craft = craftRule(p.craft)!;

        // Payday on the first day of the week.
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

        // Today's card.
        const dealt = await dealCard(p.id, p.deck_id, w.id, day, p.craft);
        if (dealt && !dealt.inst.choice) {
          const opts = dealt.card.options;
          let pick = opts[0];
          if (S.cards === "cheapest") pick = [...opts].sort((a, b) => netCost(a) - netCost(b))[0];
          else if (S.cards === "dearest") pick = [...opts].sort((a, b) => netCost(b) - netCost(a))[0];
          else pick = opts[Math.floor(rng(`pick:${p.id}:${day}`)() * opts.length)];
          await resolveCard(p.id, w.id, day, dealt.inst.id, dealt.card, pick.id);
        }

        // The hustle: make on whatever evenings are free, buying when out of supplies.
        if (S.hustle) {
          for (const ev of await availableMakingEvenings(p.id)) {
            const project = await projectOf(p.id);
            const r = rng(`make:${p.id}:${ev.id}`)();
            const menu = craft.items;
            const total = menu.reduce((n, i) => n + i.appeal, 0);
            let t = r * total;
            let item = menu[menu.length - 1];
            for (const i of menu) { t -= i.appeal; if (t <= 0) { item = i; break; } }
            if (project) item = itemOf(craft, project.item)!;
            if (!project && (await suppliesOf(p.id)) < item.batches) {
              const need = item.batches - (await suppliesOf(p.id));
              const bought = await buySupplies(p.id, w.id, day, craft, need);
              if (bought.ok) stats.get(p.id)!.supplies += craft.batchCost * need;
              else continue;
            }
            const made = await makeOn(p.id, craft, ev.id, item.key);
            if (made.ok && made.message.includes("finished")) stats.get(p.id)!.made += item.yields;
          }
          const pending = await pendingSales(p.id);
          if (pending.length) {
            const dec: Record<string, "me" | "giving"> = {};
            pending.forEach((s) => {
              dec[s.id] = rng(`dest:${s.id}`)() < 0.3 ? "giving" : "me";
              stats.get(p.id)!.revenue += s.price;
            });
            await decideSales(p.id, w.id, dec);
          }
        }
        await syncGoalsEnvelope(p.id);

        // A funded goal gets bought and a fresh £120 one opened, as a player would.
        const open = await q<{ id: string; saved_amount: number; target_amount: number }>(
          `SELECT id, saved_amount, target_amount FROM goal WHERE player_id=$1 AND bought_at IS NULL ORDER BY created_at`,
          [p.id],
        );
        for (const g of open) {
          if (g.saved_amount < g.target_amount) continue;
          const bought = await buyGoal(p.id, w.id, day, g.id);
          if (bought.ok) {
            stats.get(p.id)!.bought++;
            stats.get(p.id)!.boughtValue += bought.price;
            await addGoal(p.id, "Next thing", 12000);
          }
        }
      }
    }
  }

  for (const p of players) for (const w of weeks) await resolveWeek(p.id, w);

  const out: Result[] = [];
  for (const p of players) {
    const goals = await q<{ saved_amount: number; target_amount: number; reached_at: string | null }>(
      `SELECT saved_amount, target_amount, reached_at FROM goal WHERE player_id=$1 AND bought_at IS NULL`, [p.id]);
    const enj = await envelopeOf(p.id, "enjoyment");
    const giv = await envelopeOf(p.id, "giving_reserve");
    const failed = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM week_result WHERE player_id=$1 AND survived=FALSE`, [p.id]);
    const unpaid = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM ledger WHERE player_id=$1 AND type='unpaid_obligation'`, [p.id]);
    const unsold = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM stock_item WHERE player_id=$1 AND status='stock'`, [p.id]);
    const sold = await one<{ n: string | number }>(`SELECT COUNT(*) AS n FROM stock_item WHERE player_id=$1 AND status='sold'`, [p.id]);
    const st = stats.get(p.id)!;
    out.push({
      style, start, name: p.display_name, craft: p.craft,
      goalsSaved: goals.reduce((n, g) => n + g.saved_amount, 0),
      goalsReached: goals.filter((g) => g.reached_at).length,
      goalTotal: goals.reduce((n, g) => n + g.target_amount, 0),
      enjoyment: enj.balance, given: giv.balance,
      failedWeeks: Number(failed?.n), unpaid: Number(unpaid?.n),
      revenue: st.revenue, supplies: st.supplies,
      unsold: Number(unsold?.n), sold: Number(sold?.n), made: st.made,
      bought: st.bought, boughtValue: st.boughtValue,
    });
  }
  return out;
}

const f = (n: number) => `£${Math.round(n / 100)}`.padStart(6);

async function main() {
  const starts = ["2026-10-10", "2027-01-09"];
  const all: Result[] = [];
  for (const style of ["careful", "mixed", "spendy"] as Style[]) {
    for (const start of starts) {
      for (let r = 0; r < reps; r++) {
        all.push(...(await playSeason(style, start, r)));
        process.stderr.write(".");
      }
    }
  }
  process.stderr.write("\n");

  console.log("style     start       who    bought  worth   still-saving  Enjoy  Given  failwk unpaid | made sold unsold  revenue supplies hustle-net");
  console.log("-".repeat(130));
  for (const r of all) {
    console.log(
      `${r.style.padEnd(9)} ${r.start} ${r.name.padEnd(6)} ${String(r.bought).padStart(3)}  ${f(r.boughtValue)}   ${f(r.goalsSaved)}     ` +
      `${f(r.enjoyment)} ${f(r.given)}   ${String(r.failedWeeks).padStart(3)}   ${String(r.unpaid).padStart(4)}  | ` +
      `${String(r.made).padStart(4)} ${String(r.sold).padStart(4)} ${String(r.unsold).padStart(5)}  ${f(r.revenue)} ${f(r.supplies)}   ${f(r.revenue - r.supplies)}`,
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
