import "server-only";
import { q, one } from "./db";
import {
  addDays, credit, debit, envelopeOf, isoDate, londonToday, pickWeighted, post, rng, shortDay, weekdayOf,
  type WeekRow,
} from "./engine";
import {
  DEMAND_BANDS, itemOf, marketCapacity, type CraftRule,
} from "./hustle-data";

/**
 * The side hustle's engine — spec §7. Supplies are bought with real money, Making
 * evenings turn them into stock, stock waits, and market day sells some of it.
 * Money only ever moves through the ledger; the tables here hold the things.
 */

function fmt(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/* ----------------------------------------------------------------- supplies */

export async function suppliesOf(playerId: string): Promise<number> {
  const r = await one<{ batches: number }>(
    `SELECT batches FROM hustle_supply WHERE player_id = $1`,
    [playerId],
  );
  return r?.batches ?? 0;
}

/**
 * Supplies are paid for up front, before any return, from Goals first and then
 * Enjoyment — the same way the supplies cards pay. That is the point: it comes out
 * of the pot the player is saving from, and nothing says it will come back.
 */
export async function buySupplies(
  playerId: string,
  weekId: string,
  day: string,
  craft: CraftRule,
  count: number,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return { ok: false, error: "Pick between one and ten batches." };
  }
  const cost = craft.batchCost * count;
  const goals = await envelopeOf(playerId, "goals");
  const enjoyment = await envelopeOf(playerId, "enjoyment");
  if (goals.balance + enjoyment.balance < cost) {
    return { ok: false, error: `That's ${fmt(cost)} and you don't have it in Goals or Enjoyment.` };
  }

  const label = count === 1 ? `a batch of ${craft.supplyName}` : `${count} batches of ${craft.supplyName}`;
  const res = await debit(playerId, weekId, day, "goals", cost, `Supplies — ${label}`);
  await q(
    `INSERT INTO hustle_supply (player_id, batches) VALUES ($1,$2)
     ON CONFLICT (player_id) DO UPDATE SET batches = hustle_supply.batches + EXCLUDED.batches`,
    [playerId, count],
  );
  const raided = res.raided.length ? " Goals didn't cover all of it, so Enjoyment made up the rest." : "";
  return { ok: true, message: `Bought ${label} for ${fmt(cost)}.${raided}` };
}

/* ------------------------------------------------------------------- making */

export interface MakingEvening {
  id: string;
  day: string;
}

/** Making evenings that have come round and have not been spent on anything yet. */
export async function availableMakingEvenings(playerId: string): Promise<MakingEvening[]> {
  const rows = await q<{ id: string; day: string }>(
    `SELECT id, day::text AS day FROM evening_plan
      WHERE player_id = $1 AND kind = 'making' AND resolved_at IS NOT NULL
        AND taken_by IS NULL AND made_item IS NULL
      ORDER BY day, slot`,
    [playerId],
  );
  return rows.map((r) => ({ id: r.id, day: isoDate(r.day) }));
}

export interface Project {
  item: string;
  evenings_done: number;
}

export async function projectOf(playerId: string): Promise<Project | null> {
  return one<Project>(
    `SELECT item, evenings_done FROM hustle_project WHERE player_id = $1`,
    [playerId],
  );
}

/**
 * Spend one Making evening. A run's supplies are taken when it starts, so a
 * half-finished blanket is already paid for — and a later evening taken by a card
 * leaves it where it was rather than undoing it.
 */
export async function makeOn(
  playerId: string,
  craft: CraftRule,
  eveningId: string,
  itemKey: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const item = itemOf(craft, itemKey);
  if (!item) return { ok: false, error: "That isn't something you make." };

  const evening = await one<{ id: string; day: string }>(
    `SELECT id, day::text AS day FROM evening_plan
      WHERE id = $1 AND player_id = $2 AND kind = 'making' AND resolved_at IS NOT NULL
        AND taken_by IS NULL AND made_item IS NULL`,
    [eveningId, playerId],
  );
  if (!evening) return { ok: false, error: "That evening isn't free to make anything on." };

  const project = await projectOf(playerId);
  if (project && project.item !== itemKey) {
    const other = itemOf(craft, project.item);
    return { ok: false, error: `Finish the ${other?.label.toLowerCase() ?? "one you've started"} first.` };
  }

  if (!project) {
    const have = await suppliesOf(playerId);
    if (have < item.batches) {
      return {
        ok: false,
        error: `${item.label} needs ${item.batches} batch${item.batches === 1 ? "" : "es"} of ${craft.supplyName} and you have ${have}.`,
      };
    }
    await q(`UPDATE hustle_supply SET batches = batches - $2 WHERE player_id = $1`, [playerId, item.batches]);
    await q(
      `INSERT INTO hustle_project (player_id, item, evenings_done, started_on) VALUES ($1,$2,0,$3)`,
      [playerId, itemKey, isoDate(evening.day)],
    );
  }

  await q(`UPDATE evening_plan SET made_item = $2 WHERE id = $1`, [evening.id, itemKey]);
  await q(`UPDATE hustle_project SET evenings_done = evenings_done + 1 WHERE player_id = $1`, [playerId]);

  const now = await projectOf(playerId);
  if (!now || now.evenings_done < item.evenings) {
    return {
      ok: true,
      message: `${shortDay(evening.day)}: ${item.label}, evening ${now?.evenings_done ?? 0} of ${item.evenings}. Not finished yet.`,
    };
  }

  for (let i = 0; i < item.yields; i++) {
    await q(
      `INSERT INTO stock_item (player_id, item, price, made_on) VALUES ($1,$2,$3,$4)`,
      [playerId, itemKey, item.price, isoDate(evening.day)],
    );
  }
  await q(`DELETE FROM hustle_project WHERE player_id = $1`, [playerId]);
  return {
    ok: true,
    message: `${item.label} finished: ${item.yields} in stock at ${fmt(item.price)} each. They sell on market day, if anyone wants them.`,
  };
}

/* -------------------------------------------------------------------- stock */

export async function stockCounts(playerId: string): Promise<Record<string, number>> {
  const rows = await q<{ item: string; n: string | number }>(
    `SELECT item, COUNT(*) AS n FROM stock_item
      WHERE player_id = $1 AND status = 'stock' GROUP BY item`,
    [playerId],
  );
  return Object.fromEntries(rows.map((r) => [r.item, Number(r.n)]));
}

/* ------------------------------------------------------------------- market */

/**
 * Market day falls on the season's payday weekday, once a week. Returns the dates
 * of every market from the start of the season up to and including `today`.
 */
export async function marketDaysUpTo(
  seasonId: string,
  paydayWeekday: number,
  today: string,
  playerId?: string,
): Promise<Array<{ day: string; boost: number }>> {
  const weeks = await q<WeekRow>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week
      WHERE season_id = $1 ORDER BY idx`,
    [seasonId],
  );
  const days: Array<{ day: string; boost: number }> = [];
  for (const w of weeks) {
    const opens = isoDate(w.opens_at);
    const offset = (paydayWeekday - weekdayOf(opens) + 7) % 7;
    const d = addDays(opens, offset);
    if (d <= today) days.push({ day: d, boost: 1 });
  }
  if (playerId) {
    const extras = await q<{ day: string; boost: number }>(
      `SELECT day::text AS day, boost FROM extra_market WHERE player_id = $1 AND day <= $2`,
      [playerId, today],
    );
    for (const x of extras) {
      const d = isoDate(x.day);
      // A booked market on a regular market day just makes that one busier.
      const existing = days.find((m) => m.day === d);
      if (existing) existing.boost = x.boost / 100;
      else days.push({ day: d, boost: x.boost / 100 });
    }
  }
  return days.sort((a, b) => a.day.localeCompare(b.day));
}

export async function nextMarketDay(
  seasonId: string,
  paydayWeekday: number,
  today: string,
  playerId?: string,
): Promise<string | null> {
  const weeks = await q<WeekRow>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week WHERE season_id = $1 ORDER BY idx`,
    [seasonId],
  );
  let regular: string | null = null;
  for (const w of weeks) {
    const opens = isoDate(w.opens_at);
    const d = addDays(opens, (paydayWeekday - weekdayOf(opens) + 7) % 7);
    if (d > today) {
      regular = d;
      break;
    }
  }
  if (!playerId) return regular;
  const extra = await one<{ day: string }>(
    `SELECT day::text AS day FROM extra_market WHERE player_id = $1 AND day > $2 ORDER BY day LIMIT 1`,
    [playerId, today],
  );
  const e = extra ? isoDate(extra.day) : null;
  return e && (!regular || e < regular) ? e : regular;
}

/**
 * Resolve every market that has come round and has not been run yet. Like evenings
 * and cards this happens on arrival and is seeded, so the cron that will one day
 * run it can re-run without moving the result.
 *
 * Demand is rolled from the DAY alone — both players stand in the same town on the
 * same Saturday — while which items buyers pick is rolled per player.
 */
export async function resolveMarkets(
  playerId: string,
  craft: CraftRule,
  seasonId: string,
  paydayWeekday: number,
  today: string,
): Promise<string[]> {
  const notes: string[] = [];
  const days = await marketDaysUpTo(seasonId, paydayWeekday, today, playerId);

  for (const { day, boost } of days) {
    const band = pickWeighted([...DEMAND_BANDS], rng(`market:${day}`)());
    const capacity = Math.round(marketCapacity(day, band.factor) * boost);

    const created = await q<{ id: string }>(
      `INSERT INTO market_day (player_id, day, band, capacity, sold)
       VALUES ($1,$2,$3,$4,0) ON CONFLICT (player_id, day) DO NOTHING RETURNING id`,
      [playerId, day, band.band, capacity],
    );
    if (!created[0]) continue;
    const marketId = created[0].id;

    const stock = await q<{ id: string; item: string; price: number }>(
      `SELECT id, item, price FROM stock_item
        WHERE player_id = $1 AND status = 'stock' AND made_on <= $2
        ORDER BY made_on, id`,
      [playerId, day],
    );
    const byItem = new Map<string, Array<{ id: string; price: number }>>();
    for (const s of stock) {
      if (!byItem.has(s.item)) byItem.set(s.item, []);
      byItem.get(s.item)!.push({ id: s.id, price: s.price });
    }

    // Each unit of capacity is a buyer, and each buyer wants something from the
    // WHOLE menu, weighted by appeal, not from whatever happens to be on the table.
    // Having nothing they want is a lost sale. That is what makes the mix matter:
    // twelve of the one thing sell about as fast as three.
    const pick = rng(`market-pick:${playerId}:${day}`);
    const menu = craft.items.map((i) => ({ key: i.key, weight: i.appeal }));
    let sold = 0;
    for (let n = 0; n < capacity; n++) {
      const wanted = pickWeighted(menu, pick());
      const item = byItem.get(wanted.key)?.shift();
      if (!item) continue;
      await q(
        `UPDATE stock_item SET status = 'sold', market_id = $2 WHERE id = $1`,
        [item.id, marketId],
      );
      sold++;
    }
    await q(`UPDATE market_day SET sold = $2 WHERE id = $1`, [marketId, sold]);

    const copy = band.copy;
    const when = `${shortDay(day)} ${day.slice(8, 10)}/${day.slice(5, 7)}`;
    if (sold > 0) notes.push(`Market, ${when}. ${copy} You sold ${sold}. Decide where it goes on the Hustle screen.`);
    else if (stock.length === 0) notes.push(`Market, ${when}. ${copy} You had nothing to sell.`);
    else if (capacity === 0) notes.push(`Market, ${when}. ${copy}`);
    else notes.push(`Market, ${when}. ${copy} Nobody wanted what you had.`);
  }
  return notes;
}

export interface PendingSale {
  id: string;
  item: string;
  price: number;
  day: string;
}

/** Sold, with nowhere decided for the money yet. */
export async function pendingSales(playerId: string): Promise<PendingSale[]> {
  const rows = await q<{ id: string; item: string; price: number; day: string }>(
    `SELECT s.id, s.item, s.price, m.day::text AS day
       FROM stock_item s JOIN market_day m ON m.id = s.market_id
      WHERE s.player_id = $1 AND s.status = 'sold' AND s.dest IS NULL
      ORDER BY m.day, s.id`,
    [playerId],
  );
  return rows.map((r) => ({ ...r, day: isoDate(r.day) }));
}

export interface MarketRecord {
  day: string;
  band: string;
  /** Buyers who came. Each one wanted a single item. */
  capacity: number;
  sold: number;
  revenue: number;
}

export async function recentMarkets(playerId: string, limit = 6): Promise<MarketRecord[]> {
  const rows = await q<{ day: string; band: string; capacity: number; sold: number; revenue: string | number | null }>(
    `SELECT m.day::text AS day, m.band, m.capacity, m.sold,
            (SELECT COALESCE(SUM(s.price),0) FROM stock_item s WHERE s.market_id = m.id) AS revenue
       FROM market_day m WHERE m.player_id = $1 ORDER BY m.day DESC LIMIT $2`,
    [playerId, limit],
  );
  return rows.map((r) => ({ ...r, day: isoDate(r.day), revenue: Number(r.revenue ?? 0) }));
}

/**
 * The moral beat. Where a sale's money goes is chosen AFTER the amount is known,
 * one sale at a time, with nothing selected for the player. "Me" is banked like a
 * shift — it has to be given a job at payday. "Giving" goes straight into the
 * Giving Reserve, which can't be taken back out.
 */
export async function decideSales(
  playerId: string,
  weekId: string | null,
  decisions: Record<string, "me" | "giving" | "fundraiser">,
  today: string = londonToday(),
): Promise<{ kept: number; given: number; raised: number }> {
  const pending = await pendingSales(playerId);
  let kept = 0;
  let given = 0;
  let raised = 0;
  const fund = await openSalesFundraiser(playerId, today);

  for (const sale of pending) {
    const dest = decisions[sale.id];
    if (dest !== "me" && dest !== "giving" && dest !== "fundraiser") continue;
    if (dest === "fundraiser" && !fund) continue;

    const label = `Market — sold one (${sale.item})`;
    if (dest === "me") {
      await post(playerId, weekId, sale.day, "banked", sale.price, null, `${label}, banked until payday`);
      kept += sale.price;
    } else if (dest === "fundraiser" && fund) {
      // Given away at once: in and out on the ledger, nothing reaches an envelope.
      await post(playerId, weekId, sale.day, "sale_to_fundraiser", sale.price, null, `${label}, to your fundraiser`);
      await post(playerId, weekId, sale.day, "gift", -sale.price, null, `Gave to ${fund.cause}`);
      await q(`UPDATE stock_item SET fundraiser_id = $2 WHERE id = $1`, [sale.id, fund.id]);
      raised += sale.price;
    } else {
      const env = await envelopeOf(playerId, "giving_reserve");
      await credit(env.id, sale.price);
      await post(playerId, weekId, sale.day, "sale_to_giving", sale.price, env.id, `${label}, to Giving Reserve`);
      given += sale.price;
    }
    await q(`UPDATE stock_item SET dest = $2, decided_at = now() WHERE id = $1`, [sale.id, dest]);
  }
  return { kept, given, raised };
}

/** The player's fundraiser if it is still open and raising through sales. */
export async function openSalesFundraiser(
  playerId: string,
  today: string = londonToday(),
): Promise<{ id: string; cause: string } | null> {
  return one<{ id: string; cause: string }>(
    `SELECT f.id, f.cause FROM fundraiser f JOIN ask a ON a.id = f.ask_id
      WHERE f.player_id = $1 AND f.method = 'sales' AND a.closes >= $2
      ORDER BY f.started_on DESC LIMIT 1`,
    [playerId, today],
  );
}
