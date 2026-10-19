import "server-only";
import { q, one } from "./db";
import { BASE_DECK, addDays, isoDate, londonToday, type CardOption, type WeekRow } from "./engine";
import { planAsks } from "./asks";
import { gbp } from "./money";

/**
 * The parent's controls (spec section 10): the season, the wages, the decks, the cards, the
 * fundraisers. Everything here is read and written on the server and only reachable from the
 * admin pages, which check the role. Nothing in this file is ever sent to a player.
 */

export type Result = { ok: true; message: string } | { ok: false; error: string };
const ok = (message: string): Result => ({ ok: true, message });
const fail = (error: string): Result => ({ ok: false, error });

/* ------------------------------------------------------------------- season */

export async function pauseSeason(seasonId: string, day: string): Promise<Result> {
  const r = await q(
    `UPDATE season SET status = 'paused', paused_on = $2 WHERE id = $1 AND status = 'running' RETURNING id`,
    [seasonId, day],
  );
  return r.length ? ok("Paused. Players can see the season is paused and nothing moves.") : fail("It isn't running.");
}

/**
 * Resume. If the next week was due to start before today, the weeks that had not started are
 * pushed out in whole weeks (so payday stays on its weekday) until the next one opens on or after
 * today. The week the pause landed in is stretched to meet it, so no day is left without a week.
 * Unannounced asks in the moved weeks go with them; calendar ones (Children in Need) stay put.
 */
export async function resumeSeason(seasonId: string, day: string): Promise<Result> {
  const s = await one<{ status: string; paused_on: string | null }>(
    `SELECT status, paused_on::text AS paused_on FROM season WHERE id = $1`, [seasonId],
  );
  if (!s || s.status !== "paused" || !s.paused_on) return fail("It isn't paused.");
  const pausedOn = isoDate(s.paused_on);
  const next = await one<{ opens_at: string }>(
    `SELECT opens_at FROM week WHERE season_id = $1 AND opens_at > $2 ORDER BY idx LIMIT 1`, [seasonId, pausedOn],
  );
  const late = next ? Math.round((Date.parse(`${day}T12:00:00Z`) - Date.parse(`${isoDate(next.opens_at)}T12:00:00Z`)) / 86400000) : 0;
  const shift = late > 0 ? Math.ceil(late / 7) * 7 : 0;

  if (shift > 0) {
    // Latest week first, so no two weeks overlap while the dates are in motion.
    const weeks = await q<{ id: string; opens_at: string; closes_at: string }>(
      `SELECT id, opens_at, closes_at FROM week WHERE season_id = $1 AND opens_at > $2 ORDER BY idx DESC`,
      [seasonId, pausedOn],
    );
    for (const w of weeks) {
      await q(`UPDATE week SET opens_at = $2, closes_at = $3 WHERE id = $1`, [w.id, addDays(isoDate(w.opens_at), shift), addDays(isoDate(w.closes_at), shift)]);
    }
    // The week the pause landed in runs on until the next one opens.
    await q(
      `UPDATE week SET closes_at = $3 WHERE season_id = $1 AND opens_at <= $2 AND closes_at >= $2`,
      [seasonId, pausedOn, addDays(isoDate(next!.opens_at), shift - 1)],
    );
    const asks = await q<{ id: string; day: string; closes: string }>(
      `SELECT id, day, closes FROM ask WHERE season_id = $1 AND kind = 'unannounced' AND day > $2`,
      [seasonId, pausedOn],
    );
    for (const a of asks) {
      await q(`UPDATE ask SET day = $2, closes = $3 WHERE id = $1`, [a.id, addDays(isoDate(a.day), shift), addDays(isoDate(a.closes), shift)]);
    }
  }
  await q(`UPDATE season SET status = 'running', paused_on = NULL WHERE id = $1`, [seasonId]);
  return ok(shift > 0 ? `Resumed. Weeks still to come moved out by ${shift / 7} week${shift === 7 ? "" : "s"}.` : "Resumed.");
}

/** Add weeks to the end of the season. */
export async function extendSeason(seasonId: string, extra: number): Promise<Result> {
  const n = Math.round(extra);
  if (!(n >= 1 && n <= 12)) return fail("Add between 1 and 12 weeks.");
  const last = await one<{ idx: number; closes_at: string }>(
    `SELECT idx, closes_at FROM week WHERE season_id = $1 ORDER BY idx DESC LIMIT 1`, [seasonId],
  );
  if (!last) return fail("There are no weeks yet.");
  for (let i = 1; i <= n; i++) {
    const opens = addDays(isoDate(last.closes_at), 1 + (i - 1) * 7);
    await q(
      `INSERT INTO week (season_id, idx, opens_at, closes_at) VALUES ($1,$2,$3,$4) ON CONFLICT (season_id, idx) DO NOTHING`,
      [seasonId, last.idx + i, opens, addDays(opens, 6)],
    );
  }
  await q(`UPDATE season SET weeks = weeks + $2, status = CASE WHEN status = 'ended' THEN 'running' ELSE status END WHERE id = $1`, [seasonId, n]);
  const s = await one<{ id: string; start_date: string; weeks: number; charity_frequency: "sparse" | "normal" | "generous" }>(
    `SELECT id, start_date::text AS start_date, weeks, charity_frequency FROM season WHERE id = $1`, [seasonId],
  );
  if (s) await planAsks(s);
  return ok(`Added ${n} week${n === 1 ? "" : "s"}.`);
}

/**
 * Change how often unannounced asks turn up. Asks that have already arrived stay as they were;
 * the ones still to come are drawn again at the new rate.
 */
export async function setAskFrequency(seasonId: string, freq: string, day: string): Promise<Result> {
  if (freq !== "sparse" && freq !== "normal" && freq !== "generous") return fail("Pick sparse, normal or generous.");
  await q(`UPDATE season SET charity_frequency = $2 WHERE id = $1`, [seasonId, freq]);
  await q(`DELETE FROM ask WHERE season_id = $1 AND kind = 'unannounced' AND day > $2`, [seasonId, day]);
  const s = await one<{ id: string; start_date: string; weeks: number; charity_frequency: "sparse" | "normal" | "generous" }>(
    `SELECT id, start_date::text AS start_date, weeks, charity_frequency FROM season WHERE id = $1`, [seasonId],
  );
  if (s) await planAsks(s, day);
  return ok(`Asks are now ${freq}. Ones that have already arrived are unchanged.`);
}

/* ------------------------------------------------------------------ players */

export async function setPlayerWage(playerId: string, baseWage: number, variance: boolean): Promise<Result> {
  if (!(baseWage >= 0 && baseWage <= 100000)) return fail("That wage doesn't look right.");
  await q(`UPDATE player SET base_wage = $2, wage_variance = $3 WHERE id = $1`, [playerId, Math.round(baseWage), variance]);
  // Weeks not yet paid out are drawn again, so the change is felt from the next payday.
  await q(
    `DELETE FROM wage_roll WHERE player_id = $1 AND allocated = FALSE
        AND week_id IN (SELECT id FROM week WHERE closes_at >= $2)`,
    [playerId, londonToday()],
  );
  return ok("Saved. It applies to every week not yet paid.");
}

export async function setPlayerDeck(playerId: string, deckId: string): Promise<Result> {
  const id = deckId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24) || BASE_DECK;
  await q(`UPDATE player SET deck_id = $2 WHERE id = $1`, [playerId, id]);
  return ok(`Deck set to ${id}. The player is not told.`);
}

export async function decks(): Promise<Array<{ id: string; overrides: number }>> {
  const rows = await q<{ deck_id: string; n: number | string }>(
    `SELECT deck_id, COUNT(*) AS n FROM event_card WHERE deck_id <> $1 GROUP BY deck_id ORDER BY deck_id`, [BASE_DECK],
  );
  return [{ id: BASE_DECK, overrides: 0 }, ...rows.map((r) => ({ id: r.deck_id, overrides: Number(r.n) }))];
}

/* -------------------------------------------------------------------- cards */

export interface CardEdit {
  id: string;
  kind: "dilemma" | "event";
  title: string;
  body: string;
  weight: number;
  season_window: string | null;
  options_json: string;
  enabled: boolean;
  /** The deck this row belongs to; an override's id is "<base id>@<deck>". */
  deck_id: string;
  isOverride: boolean;
}

export async function listCards(): Promise<Array<{ id: string; kind: string; title: string; enabled: boolean; window: string | null; overridden: string[] }>> {
  const base = await q<{ id: string; kind: string; title: string; enabled: boolean; season_window: string | null }>(
    `SELECT id, kind, title, enabled, season_window FROM event_card WHERE deck_id = $1 ORDER BY kind, title`, [BASE_DECK],
  );
  const over = await q<{ id: string; deck_id: string }>(`SELECT id, deck_id FROM event_card WHERE deck_id <> $1`, [BASE_DECK]);
  const by = new Map<string, string[]>();
  for (const o of over) {
    const b = o.id.split("@")[0];
    by.set(b, [...(by.get(b) ?? []), o.deck_id]);
  }
  return base.map((c) => ({ id: c.id, kind: c.kind, title: c.title, enabled: c.enabled, window: c.season_window, overridden: by.get(c.id) ?? [] }));
}

/** A card as it would be edited for a deck: the override if there is one, else the base. */
export async function cardForEdit(id: string, deckId: string): Promise<CardEdit | null> {
  const useOverride = deckId !== BASE_DECK;
  const row =
    (useOverride ? await one<CardEdit & { options_json: string }>(
      `SELECT id, kind, title, body, weight, season_window, options_json, enabled, deck_id FROM event_card WHERE id = $1`, [`${id}@${deckId}`],
    ) : null) ??
    (await one<CardEdit & { options_json: string }>(
      `SELECT id, kind, title, body, weight, season_window, options_json, enabled, deck_id FROM event_card WHERE id = $1`, [id],
    ));
  if (!row) return null;
  return { ...row, id, deck_id: deckId, isOverride: useOverride && row.deck_id === deckId };
}

export interface CardInput {
  kind: string;
  title: string;
  body: string;
  weight: number;
  season_window: string;
  options_json: string;
}

/** Checks a card well enough that a typo cannot leave a player looking at a card that cannot resolve. */
export function validateCard(c: CardInput): string | null {
  if (c.kind !== "dilemma" && c.kind !== "event") return "Kind must be dilemma or event.";
  if (!c.title.trim() || !c.body.trim()) return "A card needs a title and some text.";
  if (!(c.weight >= 1 && c.weight <= 10)) return "Weight is a whole number from 1 to 10.";
  if (c.season_window.trim() && !/^\d{2}-\d{2}\.\.\d{2}-\d{2}$/.test(c.season_window.trim())) return "A window looks like 12-01..12-24.";
  let opts: unknown;
  try { opts = JSON.parse(c.options_json); } catch { return "The options are not valid JSON."; }
  if (!Array.isArray(opts) || opts.length < 1) return "A card needs at least one option.";
  const seen = new Set<string>();
  for (const o of opts as CardOption[]) {
    if (!o || typeof o.id !== "string" || !o.id || typeof o.label !== "string" || !o.label) return "Each option needs an id and a label.";
    if (seen.has(o.id)) return `The option id "${o.id}" is used twice.`;
    seen.add(o.id);
    const nums = [o.income, o.obligation, ...Object.values(o.spend ?? {})];
    if (nums.some((n) => n != null && (!Number.isInteger(n) || n < 0))) return "Amounts are whole pence and can't be negative.";
  }
  if (c.kind === "dilemma" && opts.length < 2) return "A dilemma needs at least two options.";
  return null;
}

export async function saveCard(id: string, deckId: string, c: CardInput): Promise<Result> {
  const err = validateCard(c);
  if (err) return fail(err);
  const base = await one<{ variants_json: string | null }>(`SELECT variants_json FROM event_card WHERE id = $1`, [id]);
  if (!base) return fail("That card doesn't exist.");
  const window = c.season_window.trim() || null;
  if (deckId === BASE_DECK) {
    await q(
      `UPDATE event_card SET kind=$2, title=$3, body=$4, weight=$5, season_window=$6, options_json=$7 WHERE id=$1`,
      [id, c.kind, c.title.trim(), c.body.trim(), Math.round(c.weight), window, c.options_json],
    );
    return ok("Saved to the main deck.");
  }
  await q(
    `INSERT INTO event_card (id, deck_id, kind, title, body, options_json, weight, season_window, variants_json, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
     ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind, title=EXCLUDED.title, body=EXCLUDED.body,
       options_json=EXCLUDED.options_json, weight=EXCLUDED.weight, season_window=EXCLUDED.season_window`,
    [`${id}@${deckId}`, deckId, c.kind, c.title.trim(), c.body.trim(), c.options_json, Math.round(c.weight), window, base.variants_json],
  );
  return ok(`Saved for the ${deckId} deck.`);
}

export async function createCard(c: CardInput & { id: string }): Promise<Result> {
  const id = c.id.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  if (!id) return fail("Give the card a short id, like fixed-bike.");
  const err = validateCard(c);
  if (err) return fail(err);
  if (await one(`SELECT 1 AS x FROM event_card WHERE id = $1`, [id])) return fail("There is already a card with that id.");
  await q(
    `INSERT INTO event_card (id, deck_id, kind, title, body, options_json, weight, season_window, enabled)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)`,
    [id, BASE_DECK, c.kind, c.title.trim(), c.body.trim(), c.options_json, Math.round(c.weight), c.season_window.trim() || null],
  );
  return ok(`Added ${id}.`);
}

export async function setCardEnabled(id: string, enabled: boolean): Promise<Result> {
  await q(`UPDATE event_card SET enabled = $2 WHERE id = $1 AND deck_id = $3`, [id, enabled, BASE_DECK]);
  return ok(enabled ? "On." : "Off. It will not be dealt.");
}

export async function removeOverride(id: string, deckId: string): Promise<Result> {
  await q(`DELETE FROM event_card WHERE id = $1`, [`${id}@${deckId}`]);
  return ok("Override removed. That deck gets the main card again.");
}

/* ------------------------------------------------------------- tier decks */

function round50(x: number): number {
  return Math.max(50, Math.round(x / 50) * 50);
}

function poundsText(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

/**
 * Scale the COSTS in a card (spend and obligations, never income) by `factor`, and change the
 * same amounts wherever they are written in the text, so a label never says £6 over a £5 cost.
 * Amounts that are not one of the card's costs (a wage, a prize) are left alone.
 */
export function scaleCard(
  card: { title: string; body: string; options: CardOption[]; variants?: Record<string, Record<string, unknown>> | null },
  factor: number,
): { title: string; body: string; options: CardOption[]; variants: Record<string, Record<string, unknown>> | null } {
  const costs = new Set<number>();
  const collect = (opts: CardOption[]) => {
    for (const o of opts) {
      if (o.obligation) costs.add(o.obligation);
      for (const v of Object.values(o.spend ?? {})) if (v) costs.add(v);
    }
  };
  collect(card.options);
  for (const v of Object.values(card.variants ?? {})) collect((v.options as CardOption[] | undefined) ?? []);

  const map = new Map<number, number>();
  for (const c of costs) map.set(c, round50(c * factor));
  const text = (s: string) =>
    s.replace(/£(\d+(?:\.\d{1,2})?)/g, (m, n) => {
      const pence = Math.round(parseFloat(n) * 100);
      return map.has(pence) ? poundsText(map.get(pence)!) : m;
    });
  const opts = (list: CardOption[]): CardOption[] =>
    list.map((o) => ({
      ...o,
      label: text(o.label),
      outcome: o.outcome ? text(o.outcome) : o.outcome,
      obligation: o.obligation ? map.get(o.obligation) : o.obligation,
      spend: o.spend
        ? (Object.fromEntries(Object.entries(o.spend).map(([k, v]) => [k, v ? map.get(v) ?? v : v])) as CardOption["spend"])
        : o.spend,
    }));

  const variants = card.variants
    ? Object.fromEntries(
        Object.entries(card.variants).map(([k, v]) => [
          k,
          {
            ...v,
            ...(typeof v.title === "string" ? { title: text(v.title) } : {}),
            ...(typeof v.body === "string" ? { body: text(v.body) } : {}),
            ...(Array.isArray(v.options) ? { options: opts(v.options as CardOption[]) } : {}),
          },
        ]),
      )
    : null;
  return { title: text(card.title), body: text(card.body), options: opts(card.options), variants };
}

/** Build (or rebuild) a difficulty deck as an override of every card in the main deck. */
export async function buildTierDeck(deckId: string, factor: number): Promise<Result> {
  const id = deckId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 24);
  if (!id || id === BASE_DECK) return fail("Give the deck a name other than standard.");
  if (!(factor >= 0.3 && factor <= 3)) return fail("The factor should be between 0.3 and 3.");
  const cards = await q<{ id: string; kind: string; title: string; body: string; weight: number; season_window: string | null; options_json: string; variants_json: string | null }>(
    `SELECT id, kind, title, body, weight, season_window, options_json, variants_json FROM event_card WHERE deck_id = $1`, [BASE_DECK],
  );
  for (const c of cards) {
    const scaled = scaleCard(
      { title: c.title, body: c.body, options: JSON.parse(c.options_json) as CardOption[], variants: c.variants_json ? JSON.parse(c.variants_json) : null },
      factor,
    );
    await q(
      `INSERT INTO event_card (id, deck_id, kind, title, body, options_json, weight, season_window, variants_json, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body, options_json=EXCLUDED.options_json,
         variants_json=EXCLUDED.variants_json`,
      [`${c.id}@${id}`, id, c.kind, scaled.title, scaled.body, JSON.stringify(scaled.options), c.weight, c.season_window, scaled.variants ? JSON.stringify(scaled.variants) : null],
    );
  }
  return ok(`Built the ${id} deck: costs at ${Math.round(factor * 100)}% on ${cards.length} cards.`);
}

/* -------------------------------------------------------------- fundraisers */

export interface FundraiserAdminRow {
  id: string;
  player: string;
  cause: string;
  target: number;
  method: string;
  sponsors: number;
  fromSales: number;
  matched: number;
  closes: string;
}

export async function allFundraisers(seasonId: string): Promise<FundraiserAdminRow[]> {
  const rows = await q<Record<string, unknown>>(
    `SELECT f.id, p.display_name AS player, f.cause, f.target, f.method, a.closes::text AS closes,
            (SELECT COALESCE(SUM(amount_given),0) FROM ask_response r WHERE r.ask_id = f.ask_id) AS sponsors,
            (SELECT COALESCE(SUM(price),0) FROM stock_item s WHERE s.fundraiser_id = f.id) AS from_sales,
            (SELECT COALESCE(SUM(amount),0) FROM fundraiser_match m WHERE m.fundraiser_id = f.id) AS matched
       FROM fundraiser f JOIN player p ON p.id = f.player_id JOIN ask a ON a.id = f.ask_id
      WHERE f.season_id = $1 ORDER BY f.started_on DESC`,
    [seasonId],
  );
  return rows.map((r) => ({
    id: String(r.id), player: String(r.player), cause: String(r.cause), target: Number(r.target), method: String(r.method),
    sponsors: Number(r.sponsors), fromSales: Number(r.from_sales), matched: Number(r.matched), closes: isoDate(r.closes),
  }));
}

/** The admin adds to a fundraiser's total. It never touches a player's envelopes or ledger. */
export async function matchFundraiser(fundraiserId: string, amount: number, day: string): Promise<Result> {
  if (!(amount > 0)) return fail("Put in an amount to add.");
  const f = await one(`SELECT 1 AS x FROM fundraiser WHERE id = $1`, [fundraiserId]);
  if (!f) return fail("That fundraiser isn't there.");
  await q(`INSERT INTO fundraiser_match (fundraiser_id, amount, day) VALUES ($1,$2,$3)`, [fundraiserId, Math.round(amount), day]);
  return ok(`Added ${gbp(Math.round(amount))}.`);
}

/* ------------------------------------------------------------------- ledgers */

export async function ledgerFor(playerId: string, limit = 300): Promise<Array<{ day: string; type: string; amount: number; note: string }>> {
  const rows = await q<{ day: string; type: string; amount: number; note: string }>(
    `SELECT day::text AS day, type, amount, note FROM ledger WHERE player_id = $1 ORDER BY day DESC, created_at DESC LIMIT $2`,
    [playerId, limit],
  );
  return rows;
}

export async function seasonWeeks(seasonId: string): Promise<WeekRow[]> {
  return q<WeekRow>(`SELECT id, season_id, idx, opens_at::text AS opens_at, closes_at::text AS closes_at FROM week WHERE season_id = $1 ORDER BY idx`, [seasonId]);
}
