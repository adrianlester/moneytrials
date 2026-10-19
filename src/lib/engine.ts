import "server-only";
import { q, one } from "./db";
import { ALL_TYPES, ENVELOPES, raidOrder, type EnvelopeType } from "./envelopes";
import {
  EVENINGS, EVENINGS_PER_WEEK, MAX_SHIFTS_PER_WEEK, isEveningKind, rollGoingOutCost,
  type EveningKind,
} from "./evenings";


/* ------------------------------------------------------------------ dates */

/** The game runs on Europe/London days; the server may not. */
export function londonToday(): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date());
}

/**
 * A DATE column comes back as a string from postgres.js and as a Date from
 * PGlite. `String(aDate).slice(0, 10)` then quietly yields "Mon Sep 21", which
 * looks like a date and parses to Invalid Date. Everything that reads a date off
 * a row goes through here.
 */
export function isoDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${isoDate(iso)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): number {
  return new Date(`${isoDate(iso)}T12:00:00Z`).getUTCDay();
}

/* --------------------------------------------------------- deterministic RNG */

/**
 * Seeded so that a given (player, day) always produces the same roll. Cards must
 * not change if the page is refreshed, and the day-rollover cron must be able to
 * re-run without dealing a different hand.
 */
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: string): () => number {
  let x = hash32(seed) || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    return x / 4294967296;
  };
}

export function pickWeighted<T extends { weight: number }>(items: T[], r: number): T {
  const total = items.reduce((n, i) => n + i.weight, 0);
  let t = r * total;
  for (const i of items) {
    t -= i.weight;
    if (t <= 0) return i;
  }
  return items[items.length - 1];
}

/* ------------------------------------------------------------------- types */

export interface CardOption {
  id: string;
  label: string;
  /** Money earned, banked until the next payday so every pound still gets a job. */
  income?: number;
  /** Money out, by preferred envelope. Raids if short. */
  spend?: Partial<Record<EnvelopeType, number>>;
  /** An obligation. Failing to cover it fails the week. */
  obligation?: number;
  /**
   * Consumes one of the week's five evenings (§6). This is what makes the cheap
   * option cost something: the money stays, the evening does not.
   */
  takesEvening?: boolean;
  /** Batches of side-hustle supplies this option puts in the cupboard (§7). */
  grantsSupplies?: number;
  /** Books an extra market `daysAhead` days from now: a school fair, the Christmas market. */
  extraMarket?: { daysAhead: number; boost?: number };
  /** Free text shown after the choice resolves. */
  outcome?: string;
}

export interface Card {
  id: string;
  deck_id: string;
  kind: "dilemma" | "event";
  title: string;
  body: string;
  weight: number;
  season_window?: string | null;
  options: CardOption[];
  /** Per-craft text overrides for the same card. See applyVariant(). */
  variants?: Record<string, Partial<Pick<Card, "title" | "body" | "options">>> | null;
}

/**
 * Both players get the SAME card on the same day — the comparison view depends on
 * it — but the detail that makes a card land is personal: Robin's yarn is Sam's
 * baking ingredients. A variant swaps the wording of one card for one craft and
 * leaves the beat, the day and the id alone.
 *
 * Craft is used as the key because it is the one per-player fact set at season
 * start. A craft with no variant falls back to the generic wording.
 */
export function applyVariant(card: Card, craft: string | null): Card {
  const v = craft ? card.variants?.[craft] : null;
  if (!v) return card;
  return {
    ...card,
    title: v.title ?? card.title,
    body: v.body ?? card.body,
    options: v.options ?? card.options,
  };
}

export interface EnvelopeRow {
  id: string;
  player_id: string;
  type: EnvelopeType;
  balance: number;
  locked: boolean;
  raidable: boolean;
  zero_since: string | null;
}

export interface WeekRow {
  id: string;
  season_id: string;
  idx: number;
  opens_at: string;
  closes_at: string;
}

/* ------------------------------------------------------------------ ledger */

export async function post(
  playerId: string,
  weekId: string | null,
  day: string,
  type: string,
  amount: number,
  envelopeId: string | null,
  note = "",
): Promise<void> {
  await q(
    `INSERT INTO ledger (player_id, week_id, day, type, amount, envelope_id, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [playerId, weekId, day, type, amount, envelopeId, note],
  );
}

export async function envelopes(playerId: string): Promise<EnvelopeRow[]> {
  const rows = await q<EnvelopeRow>(
    `SELECT id, player_id, type, balance, locked, raidable, zero_since
       FROM envelope WHERE player_id = $1`,
    [playerId],
  );
  return rows.sort((a, b) => ENVELOPES[a.type].order - ENVELOPES[b.type].order);
}

export async function envelopeOf(playerId: string, type: EnvelopeType): Promise<EnvelopeRow> {
  const e = await one<EnvelopeRow>(
    `SELECT id, player_id, type, balance, locked, raidable, zero_since
       FROM envelope WHERE player_id = $1 AND type = $2`,
    [playerId, type],
  );
  if (!e) throw new Error(`missing envelope ${type} for ${playerId}`);
  return e;
}

export async function credit(envId: string, amount: number): Promise<void> {
  await q(`UPDATE envelope SET balance = balance + $2 WHERE id = $1`, [envId, amount]);
}

/**
 * Take `amount` from `preferred`, falling back through the raidable envelopes.
 * Returns what it could not cover and which envelopes it raided.
 *
 * Giving envelopes are never in raidOrder() and are never passed here as a
 * fallback, which is how the irrevocability rule survives every code path.
 */
export async function debit(
  playerId: string,
  weekId: string | null,
  day: string,
  preferred: EnvelopeType,
  amount: number,
  note: string,
): Promise<{ shortfall: number; raided: EnvelopeType[] }> {
  let left = amount;
  const raided: EnvelopeType[] = [];
  const order: EnvelopeType[] = [preferred, ...raidOrder().filter((t) => t !== preferred)];

  for (const type of order) {
    if (left <= 0) break;
    const env = await envelopeOf(playerId, type);
    if (type !== preferred && !env.raidable) continue;
    if (env.balance <= 0) continue;
    const take = Math.min(env.balance, left);
    await credit(env.id, -take);
    await post(playerId, weekId, day, "spend", -take, env.id, note);
    if (type !== preferred) raided.push(type);
    left -= take;
  }

  if (raided.includes("goals")) {
    // Raiding a Goal resets its streak badge but not its balance.
    await q(`UPDATE goal SET streak = 0 WHERE player_id = $1 AND reached_at IS NULL`, [playerId]);
  }

  return { shortfall: left, raided };
}

/* -------------------------------------------------------------------- weeks */

export async function weekFor(seasonId: string, day: string): Promise<WeekRow | null> {
  return one<WeekRow>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week
      WHERE season_id = $1 AND opens_at <= $2 AND closes_at >= $2`,
    [seasonId, day],
  );
}

/** Weeks are created up front so the calendar strip and scheduled asks can see ahead. */
export async function buildWeeks(seasonId: string, startDate: string, weeks: number): Promise<void> {
  for (let i = 0; i < weeks; i++) {
    const opens = addDays(startDate, i * 7);
    await q(
      `INSERT INTO week (season_id, idx, opens_at, closes_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT (season_id, idx) DO NOTHING`,
      [seasonId, i + 1, opens, addDays(opens, 6)],
    );
  }
}

/* --------------------------------------------------------------------- wage */

const BANDS = [
  { band: "base" as const,    weight: 60, factor: 1.0 },
  { band: "reduced" as const, weight: 20, factor: 0.63 },
  { band: "boosted" as const, weight: 15, factor: 1.37 },
  { band: "zero" as const,    weight: 5,  factor: 0 },
];

/**
 * Lumpy by design. The spec is explicit that a flat wage every week is wrong,
 * and that the player should see one week ahead — so the roll for week N+1 is
 * generated as soon as week N opens.
 */
export async function ensureWageRoll(
  playerId: string,
  weekId: string,
  baseWage: number,
  variance: boolean,
): Promise<void> {
  const existing = await one(
    `SELECT id FROM wage_roll WHERE player_id = $1 AND week_id = $2`,
    [playerId, weekId],
  );
  if (existing) return;

  let band: (typeof BANDS)[number] = BANDS[0];
  if (variance) band = pickWeighted(BANDS, rng(`wage:${playerId}:${weekId}`)());
  const amount = Math.round((baseWage * band.factor) / 500) * 500;

  await q(
    `INSERT INTO wage_roll (player_id, week_id, amount, band) VALUES ($1,$2,$3,$4)
     ON CONFLICT (player_id, week_id) DO NOTHING`,
    [playerId, weekId, amount, band.band],
  );
}

/* --------------------------------------------------------------------- cards */

interface CardRow {
  id: string;
  deck_id: string;
  kind: "dilemma" | "event";
  title: string;
  body: string;
  weight: number;
  season_window: string | null;
  options_json: string;
  variants_json: string | null;
}

export async function cardById(id: string): Promise<Card | null> {
  const row = await one<CardRow>(
    `SELECT id, deck_id, kind, title, body, weight, season_window, options_json, variants_json
       FROM event_card WHERE id = $1`,
    [id],
  );
  if (!row) return null;
  return {
    ...row,
    options: JSON.parse(row.options_json) as CardOption[],
    variants: row.variants_json ? JSON.parse(row.variants_json) : null,
  };
}

/** Every day's card is chosen from this deck. Other decks only override how a card reads for a player. */
export const BASE_DECK = "standard";

/**
 * The card as THIS player sees it. Both players are dealt the same card on the same day; a
 * difficulty deck changes its numbers, not which card it is. An override is stored as
 * `<card id>@<deck id>`, and the card comes back under the base id, so nothing a player's
 * browser holds ever names the deck. Unknown or missing override: the base card.
 */
export async function cardForPlayer(
  cardId: string,
  deckId: string | null,
  craft: string | null,
): Promise<Card | null> {
  const base = await cardById(cardId);
  if (!base) return null;
  let use = base;
  if (deckId && deckId !== base.deck_id) {
    const o = await cardById(`${cardId}@${deckId}`);
    if (o) use = o;
  }
  return applyVariant({ ...use, id: base.id, deck_id: base.deck_id }, craft);
}

export async function deck(deckId: string): Promise<Card[]> {
  const rows = await q<CardRow>(
    `SELECT id, deck_id, kind, title, body, weight, season_window, options_json, variants_json
       FROM event_card WHERE deck_id = $1 AND enabled = TRUE`,
    [deckId],
  );
  return rows.map((r) => ({
    ...r,
    options: JSON.parse(r.options_json) as CardOption[],
    variants: r.variants_json ? JSON.parse(r.variants_json) : null,
  }));
}

/**
 * A card may carry a season_window of "MM-DD..MM-DD". Birthday and seasonal cards
 * are only dealt inside it — a Granny card in March is nonsense. Windows
 * wrap the year end, so "12-20..01-05" works.
 */
export function inWindow(window: string | null | undefined, day: string): boolean {
  if (!window) return true;
  const m = /^(\d{2}-\d{2})\.\.(\d{2}-\d{2})$/.exec(window.trim());
  if (!m) return true;
  const [, from, to] = m;
  const today = day.slice(5);
  return from <= to ? today >= from && today <= to : today >= from || today <= to;
}

export interface DealtCard {
  inst: { id: string; choice: string | null; outcome_json: string | null };
  card: Card;
}

export async function dealCard(
  playerId: string,
  deckId: string,
  weekId: string,
  day: string,
  craft: string | null = null,
): Promise<DealtCard | null> {
  const existing = await one<{ id: string; card_id: string; choice: string | null; outcome_json: string | null }>(
    `SELECT id, card_id, choice, outcome_json FROM event_inst WHERE player_id = $1 AND day = $2`,
    [playerId, day],
  );
  if (existing) {
    const card = await cardForPlayer(existing.card_id, deckId, craft);
    return card ? { inst: existing, card } : null;
  }

  const all = await deck(BASE_DECK);
  const pool = all.filter((c) => inWindow(c.season_window, day));
  if (!pool.length) return null;

  // No repeats within the season while there is anything unseen left.
  const seen = await q<{ card_id: string }>(
    `SELECT card_id FROM event_inst WHERE player_id = $1`,
    [playerId],
  );
  const seenIds = new Set(seen.map((s) => s.card_id));
  const unseen = pool.filter((c) => !seenIds.has(c.id));
  const choosable = unseen.length ? unseen : pool;

  // Seeded on the DAY, not the player or their deck, so both players get the same card.
  const card = pickWeighted(choosable, rng(`card:${day}:${BASE_DECK}`)());

  const rows = await q<{ id: string }>(
    `INSERT INTO event_inst (week_id, day, card_id, player_id)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (player_id, day) DO NOTHING
     RETURNING id`,
    [weekId, day, card.id, playerId],
  );
  const id =
    rows[0]?.id ??
    (await one<{ id: string }>(
      `SELECT id FROM event_inst WHERE player_id = $1 AND day = $2`,
      [playerId, day],
    ))!.id;

  const shown = await cardForPlayer(card.id, deckId, craft);
  return shown ? { inst: { id, choice: null, outcome_json: null }, card: shown } : null;
}

export interface Resolution {
  lines: string[];
  raided: EnvelopeType[];
  failed: boolean;
}

function fmt(pence: number): string {
  return pence % 100 === 0 ? `£${pence / 100}` : `£${(pence / 100).toFixed(2)}`;
}

export async function resolveCard(
  playerId: string,
  weekId: string,
  day: string,
  instId: string,
  card: Card,
  optionId: string,
): Promise<Resolution> {
  const opt = card.options.find((o) => o.id === optionId);
  if (!opt) throw new Error("no such option");

  const lines: string[] = [];
  const raided: EnvelopeType[] = [];
  let failed = false;

  if (opt.outcome) lines.push(opt.outcome);

  if (opt.income) {
    await post(playerId, weekId, day, "banked", opt.income, null, `${card.title} — banked until payday`);
    lines.push(`+${fmt(opt.income)} banked. It arrives with your wage on payday.`);
  }

  for (const [type, amount] of Object.entries(opt.spend ?? {}) as [EnvelopeType, number][]) {
    const res = await debit(playerId, weekId, day, type, amount, card.title);
    raided.push(...res.raided);
    if (res.raided.length) {
      const names = res.raided.map((t) => ENVELOPES[t].label).join(" and ");
      lines.push(`${ENVELOPES[type].label} didn't cover it, so ${names} made up the rest.`);
    }
    if (res.shortfall > 0) {
      lines.push(`${fmt(res.shortfall)} of that could not be covered.`);
    }
  }

  if (opt.obligation) {
    const res = await debit(playerId, weekId, day, "bills", opt.obligation, `${card.title} (obligation)`);
    raided.push(...res.raided);
    if (res.raided.length) {
      const names = res.raided.map((t) => ENVELOPES[t].label).join(" and ");
      lines.push(`Bills didn't cover it, so ${names} made up the rest.`);
    }
    if (res.shortfall > 0) {
      await post(playerId, weekId, day, "unpaid_obligation", -res.shortfall, null, card.title);
      lines.push(`${fmt(res.shortfall)} of it is unpaid. That's an obligation missed.`);
      failed = true;
    }
  }

  if (opt.grantsSupplies) {
    await q(
      `INSERT INTO hustle_supply (player_id, batches) VALUES ($1,$2)
       ON CONFLICT (player_id) DO UPDATE SET batches = hustle_supply.batches + EXCLUDED.batches`,
      [playerId, opt.grantsSupplies],
    );
    lines.push(
      opt.grantsSupplies === 1
        ? "That's a batch of supplies in the cupboard."
        : `That's ${opt.grantsSupplies} batches of supplies in the cupboard.`,
    );
  }

  if (opt.extraMarket) {
    const marketDay = addDays(day, opt.extraMarket.daysAhead);
    await q(
      `INSERT INTO extra_market (player_id, day, boost, source) VALUES ($1,$2,$3,$4)
       ON CONFLICT (player_id, day) DO NOTHING`,
      [playerId, marketDay, Math.round((opt.extraMarket.boost ?? 1.3) * 100), card.title],
    );
    lines.push(`A market is booked for ${shortDay(marketDay)} ${marketDay.slice(8, 10)}/${marketDay.slice(5, 7)}. Whatever is in stock by then can sell.`);
  }

  if (opt.takesEvening) {
    const { note } = await takeEvening(playerId, day, card.id);
    if (note) lines.push(note);
  }

  await q(
    `UPDATE event_inst SET choice = $2, outcome_json = $3, resolved_at = now() WHERE id = $1`,
    [instId, optionId, JSON.stringify({ lines, raided, failed })],
  );

  await syncGoalsEnvelope(playerId);
  await touchEnjoymentZero(playerId, day);
  return { lines, raided, failed };
}

/* ------------------------------------------------------ enjoyment depletion */

const IMPULSE_BIG: ReadonlyArray<readonly [string, number]> = [
  ["a hoodie you saw online", 2400],
  ["a takeaway, on your own", 1450],
  ["a game in a sale", 1299],
  ["nail stuff you already own most of", 980],
  ["a bag of vinyl stickers", 650],
];

export async function touchEnjoymentZero(playerId: string, day: string): Promise<void> {
  const env = await envelopeOf(playerId, "enjoyment");
  if (env.balance > 0) {
    if (env.zero_since) await q(`UPDATE envelope SET zero_since = NULL WHERE id = $1`, [env.id]);
    return;
  }
  if (!env.zero_since) {
    await q(`UPDATE envelope SET zero_since = $2 WHERE id = $1`, [env.id, day]);
  }
}

/**
 * "You've not spent anything on yourself in a fortnight. You caved and bought X."
 * No score penalty — the spec is explicit that the point is loss of control.
 */
export async function checkEnjoymentDepletion(
  playerId: string,
  weekId: string | null,
  day: string,
): Promise<string | null> {
  const env = await envelopeOf(playerId, "enjoyment");
  if (!env.zero_since) return null;
  const since = String(env.zero_since).slice(0, 10);
  const days = Math.round(
    (Date.parse(`${day}T12:00:00Z`) - Date.parse(`${since}T12:00:00Z`)) / 86400000,
  );
  if (days <= 10) return null;

  const r = rng(`impulse:${playerId}:${day}`);
  const [what, cost] = IMPULSE_BIG[Math.floor(r() * IMPULSE_BIG.length)];
  const res = await debit(playerId, weekId, day, "enjoyment", cost, `Impulse — ${what}`);
  await q(`UPDATE envelope SET zero_since = NULL WHERE id = $1`, [env.id]);
  const covered = cost - res.shortfall;
  if (covered <= 0) return null;
  return `You've not spent anything on yourself in a fortnight. You caved and bought ${what} — ${fmt(covered)}.`;
}

/* ------------------------------------------------------------------- payday */

export interface PaydayView {
  week: WeekRow;
  wage: number;
  band: string;
  banked: number;
  committed: number;
  committedCause: string | null;
  available: number;
  /** An active loan's repayment due this payday, what could be covered, and what could not. */
  loanId: string | null;
  loanDue: number;
  loanPaid: number;
  loanShortfall: number;
  alreadyAllocated: boolean;
  nextWeek: { idx: number; amount: number; band: string } | null;
}

export async function paydayView(
  playerId: string,
  seasonId: string,
  day: string,
  baseWage: number,
  variance: boolean,
): Promise<PaydayView | null> {
  const week = await weekFor(seasonId, day);
  if (!week) return null;

  await ensureWageRoll(playerId, week.id, baseWage, variance);

  const roll = await one<{ amount: number; band: string; allocated: boolean }>(
    `SELECT amount, band, allocated FROM wage_roll WHERE player_id = $1 AND week_id = $2`,
    [playerId, week.id],
  );

  // Mid-week earnings banked since the last payday arrive with this wage.
  const bankedRows = await q<{ total: string | number | null }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger
      WHERE player_id = $1 AND type = 'banked' AND day < $2`,
    [playerId, week.opens_at],
  );
  const bankedIn = await q<{ total: string | number | null }>(
    `SELECT COALESCE(SUM(amount),0) AS total FROM ledger
      WHERE player_id = $1 AND type = 'banked_in'`,
    [playerId],
  );
  const banked = Number(bankedRows[0]?.total ?? 0) - Number(bankedIn[0]?.total ?? 0);

  const commitment = await one<{ amount: number; cause: string | null }>(
    `SELECT c.amount, cs.name AS cause FROM commitment c
       LEFT JOIN cause cs ON cs.id = c.cause_id
      WHERE c.player_id = $1`,
    [playerId],
  );
  const committed = commitment?.amount ?? 0;

  // Next week's rota is visible on payday — a lean week is foreseeable, one week ahead.
  const next = await one<WeekRow>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week WHERE season_id = $1 AND idx = $2`,
    [seasonId, week.idx + 1],
  );
  let nextWeek: PaydayView["nextWeek"] = null;
  if (next) {
    await ensureWageRoll(playerId, next.id, baseWage, variance);
    const nr = await one<{ amount: number; band: string }>(
      `SELECT amount, band FROM wage_roll WHERE player_id = $1 AND week_id = $2`,
      [playerId, next.id],
    );
    if (nr) nextWeek = { idx: next.idx, amount: nr.amount, band: nr.band };
  }

  // A loan repayment comes out before anything is allocated, like Committed Giving.
  const loan = await one<{ id: string; outstanding: number; weekly_repayment: number }>(
    `SELECT id, outstanding, weekly_repayment FROM loan WHERE player_id = $1 AND status = 'active'`,
    [playerId],
  );
  const loanDue = loan ? Math.min(loan.weekly_repayment, loan.outstanding) : 0;

  const wage = roll?.amount ?? 0;
  const gross = Math.max(0, wage + Math.max(0, banked) - committed);
  const loanPaid = Math.min(loanDue, gross);
  return {
    week,
    wage,
    band: roll?.band ?? "base",
    banked: Math.max(0, banked),
    committed,
    committedCause: commitment?.cause ?? null,
    available: gross - loanPaid,
    loanId: loan?.id ?? null,
    loanDue,
    loanPaid,
    loanShortfall: loanDue - loanPaid,
    alreadyAllocated: roll?.allocated ?? false,
    nextWeek,
  };
}

/**
 * The gate: the week cannot advance until income is fully allocated. Anything
 * left over is nibbled by an impulse purchase and reported neutrally.
 */
export async function runPayday(
  playerId: string,
  view: PaydayView,
  day: string,
  amounts: Partial<Record<EnvelopeType, number>>,
): Promise<{ ok: true; notes: string[] } | { ok: false; error: string }> {
  if (view.alreadyAllocated) {
    return { ok: false, error: "This week's wage has already been allocated." };
  }
  if (Object.values(amounts).some((v) => (v ?? 0) < 0)) {
    return { ok: false, error: "Amounts can't be negative." };
  }

  const assigned = Object.values(amounts).reduce<number>((n, v) => n + (v ?? 0), 0);
  if (assigned > view.available) {
    return { ok: false, error: `That's ${fmt(assigned - view.available)} more than you have.` };
  }
  // The gate, taken at its strictest: the week cannot start on money with no job.
  // the designer's call, 18 Sep — the softer reading (nibble the leftover, bank the rest)
  // made ignoring the rule cost about a tenth of what was ignored.
  if (assigned < view.available) {
    return { ok: false, error: `${fmt(view.available - assigned)} still has no job.` };
  }

  const notes: string[] = [];

  await post(playerId, view.week.id, day, "wage", view.wage, null, `Week ${view.week.idx} wage (${view.band})`);
  if (view.banked > 0) {
    await post(playerId, view.week.id, day, "banked_in", view.banked, null, "Banked earnings");
  }

  if (view.committed > 0) {
    const env = await envelopeOf(playerId, "committed_giving");
    await post(
      playerId, view.week.id, day, "committed_giving", -view.committed, env.id,
      view.committedCause ? `Committed giving — ${view.committedCause}` : "Committed giving",
    );
    notes.push(`${fmt(view.committed)} left for ${view.committedCause ?? "your cause"} before you saw it.`);
  }

  if (view.loanId && view.loanDue > 0) {
    if (view.loanPaid > 0) {
      await post(playerId, view.week.id, day, "loan_repayment", -view.loanPaid, null, `Loan repayment, week ${view.week.idx}`);
      await q(
        `UPDATE loan SET outstanding = outstanding - $2,
                status = CASE WHEN outstanding - $2 <= 0 THEN 'repaid' ELSE status END
          WHERE id = $1`,
        [view.loanId, view.loanPaid],
      );
      notes.push(`${fmt(view.loanPaid)} went on your loan before you saw it.`);
    }
    if (view.loanShortfall > 0) {
      // Defaulting fails the week. What was missed stays owing.
      await post(
        playerId, view.week.id, day, "unpaid_obligation", 0, null,
        `Loan repayment ${fmt(view.loanShortfall)} short`,
      );
      notes.push(`The loan repayment was ${fmt(view.loanShortfall)} short. That counts as a failed week and it is still owed.`);
    }
  }

  // Bills and Committed Giving don't roll over; clear before re-assigning.
  for (const type of ALL_TYPES) {
    if (!ENVELOPES[type].rollsOver) {
      const env = await envelopeOf(playerId, type);
      if (env.balance !== 0) await credit(env.id, -env.balance);
    }
  }

  for (const [type, amount] of Object.entries(amounts) as [EnvelopeType, number][]) {
    if (!amount) continue;
    const env = await envelopeOf(playerId, type);
    await credit(env.id, amount);
    await post(playerId, view.week.id, day, "allocation", amount, env.id, `Week ${view.week.idx} allocation`);
    await q(
      `INSERT INTO allocation (player_id, week_id, envelope_id, amount) VALUES ($1,$2,$3,$4)
       ON CONFLICT (player_id, week_id, envelope_id) DO UPDATE SET amount = EXCLUDED.amount`,
      [playerId, view.week.id, env.id, amount],
    );
  }

  await q(`UPDATE wage_roll SET allocated = TRUE WHERE player_id = $1 AND week_id = $2`, [playerId, view.week.id]);
  await syncGoalsEnvelope(playerId);
  await touchEnjoymentZero(playerId, day);

  return { ok: true, notes };
}

/**
 * The Goals envelope is one pot; named goals fill from it in the order they were
 * created. saved_amount is therefore always derivable from the pot, which keeps
 * the ledger the single source of truth.
 */
export async function syncGoalsEnvelope(playerId: string): Promise<void> {
  const env = await envelopeOf(playerId, "goals");
  const goals = await q<{ id: string; target_amount: number; saved_amount: number; reached_at: string | null }>(
    `SELECT id, target_amount, saved_amount, reached_at FROM goal
      WHERE player_id = $1 AND bought_at IS NULL ORDER BY created_at`,
    [playerId],
  );
  let pot = env.balance;
  for (const g of goals) {
    const put = Math.min(pot, g.target_amount);
    pot -= put;
    const reached = put >= g.target_amount;
    await q(
      `UPDATE goal
          SET saved_amount = $2,
              reached_at = CASE WHEN $3 AND reached_at IS NULL THEN now() ELSE reached_at END
        WHERE id = $1`,
      [g.id, put, reached],
    );
  }
}

/**
 * Buy a funded goal. The price comes out of the Goals pot (it is real money
 * leaving, so it is in the ledger) and the goal is kept as something owned. Only a
 * goal the pot covers RIGHT NOW can be bought: reaching it earlier and then being
 * raided below the price does not count.
 *
 * The pot then fills whichever goal comes next, which is what stops a careful
 * player ending the season with a full bar and nothing to do with the money.
 */
export async function buyGoal(
  playerId: string,
  weekId: string | null,
  day: string,
  goalId: string,
): Promise<{ ok: true; name: string; price: number } | { ok: false; error: string }> {
  await syncGoalsEnvelope(playerId);
  const goal = await one<{ id: string; name: string; target_amount: number; saved_amount: number }>(
    `SELECT id, name, target_amount, saved_amount FROM goal
      WHERE id = $1 AND player_id = $2 AND bought_at IS NULL`,
    [goalId, playerId],
  );
  if (!goal) return { ok: false, error: "That goal isn't there to buy." };
  if (goal.saved_amount < goal.target_amount) {
    return { ok: false, error: `${goal.name} isn't fully funded yet.` };
  }

  const env = await envelopeOf(playerId, "goals");
  await credit(env.id, -goal.target_amount);
  await post(playerId, weekId, day, "goal_bought", -goal.target_amount, env.id, `Bought — ${goal.name}`);
  await q(`UPDATE goal SET bought_at = now(), saved_amount = target_amount WHERE id = $1`, [goal.id]);
  await syncGoalsEnvelope(playerId);
  return { ok: true, name: goal.name, price: goal.target_amount };
}

/** At most three goals are open at once, so the pot always has somewhere to go but not everywhere. */
export const MAX_OPEN_GOALS = 3;

export async function addGoal(
  playerId: string,
  name: string,
  price: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!name.trim()) return { ok: false, error: "Name the thing." };
  if (!Number.isInteger(price) || price < 100) return { ok: false, error: "Give it a real price." };
  const open = await one<{ n: string | number }>(
    `SELECT COUNT(*) AS n FROM goal WHERE player_id = $1 AND bought_at IS NULL`,
    [playerId],
  );
  if (Number(open?.n) >= MAX_OPEN_GOALS) {
    return { ok: false, error: `You already have ${MAX_OPEN_GOALS} goals open.` };
  }
  await q(`INSERT INTO goal (player_id, name, target_amount) VALUES ($1,$2,$3)`, [playerId, name.trim(), price]);
  await syncGoalsEnvelope(playerId);
  return { ok: true };
}

/* -------------------------------------------------------------- week result */

export async function resolveWeek(playerId: string, week: WeekRow): Promise<void> {
  const existing = await one(
    `SELECT id FROM week_result WHERE player_id = $1 AND week_id = $2`,
    [playerId, week.id],
  );
  if (existing) return;

  const unpaid = await q<{ note: string; amount: number }>(
    `SELECT note, amount FROM ledger
      WHERE player_id = $1 AND week_id = $2 AND type = 'unpaid_obligation'`,
    [playerId, week.id],
  );

  const prev = await one<{ streak: number }>(
    `SELECT wr.streak FROM week_result wr
       JOIN week w ON w.id = wr.week_id
      WHERE wr.player_id = $1 AND w.idx = $2`,
    [playerId, week.idx - 1],
  );

  const survived = unpaid.length === 0;
  const streak = survived ? (prev?.streak ?? 0) + 1 : 0;

  await q(
    `INSERT INTO week_result (player_id, week_id, survived, failures, streak, points)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (player_id, week_id) DO NOTHING`,
    [playerId, week.id, survived, JSON.stringify(unpaid.map((u) => u.note)), streak, survived ? 1 : 0],
  );
}

/* ----------------------------------------------------------------- evenings */

export interface EveningRow {
  id: string;
  player_id: string;
  week_id: string;
  slot: number;
  day: string;
  kind: EveningKind;
  planned_cost: number;
  actual_cost: number;
  earned: number;
  taken_by: string | null;
  resolved_at: string | null;
  made_item: string | null;
}

/**
 * Slot N is the Nth day of the game week. An evening needs a date before a card
 * can take it off you, and before "what you lost" means anything.
 */
export function eveningDay(week: WeekRow, slot: number): string {
  return addDays(isoDate(week.opens_at), slot - 1);
}

export async function eveningsFor(playerId: string, weekId: string): Promise<EveningRow[]> {
  const rows = await q<EveningRow>(
    `SELECT id, player_id, week_id, slot, day::text AS day, kind, planned_cost,
            actual_cost, earned, taken_by, resolved_at, made_item
       FROM evening_plan WHERE player_id = $1 AND week_id = $2 ORDER BY slot`,
    [playerId, weekId],
  );
  return rows;
}

/**
 * Commit the week's five evenings. Costs for going out are rolled now and stored
 * as planned_cost, but the player is only ever shown the range until the evening
 * arrives — §6's point is that time is committed before its price is known.
 */
export async function planEvenings(
  playerId: string,
  week: WeekRow,
  kinds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (kinds.length !== EVENINGS_PER_WEEK) {
    return { ok: false, error: `All ${EVENINGS_PER_WEEK} evenings need a plan.` };
  }
  if (!kinds.every(isEveningKind)) {
    return { ok: false, error: "That isn't something an evening can be spent on." };
  }
  if (kinds.filter((k) => k === "shift").length > MAX_SHIFTS_PER_WEEK) {
    return { ok: false, error: `No more than ${MAX_SHIFTS_PER_WEEK} extra shifts in a week.` };
  }

  const existing = await eveningsFor(playerId, week.id);
  if (existing.length > 0) return { ok: false, error: "This week's evenings are already planned." };

  for (let i = 0; i < kinds.length; i++) {
    const slot = i + 1;
    const kind = kinds[i] as EveningKind;
    const rule = EVENINGS[kind];
    const day = eveningDay(week, slot);
    const cost = rule.costRange
      ? rollGoingOutCost(rng(`evening:${playerId}:${week.id}:${slot}`))
      : 0;
    await q(
      `INSERT INTO evening_plan (player_id, week_id, slot, day, kind, planned_cost, earned)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [playerId, week.id, slot, day, kind, cost, rule.earns],
    );
  }

  await q(
    `UPDATE wage_roll SET evenings_planned = TRUE WHERE player_id = $1 AND week_id = $2`,
    [playerId, week.id],
  );
  return { ok: true };
}

/**
 * Resolve every planned evening whose day has arrived. Shifts bank their pay so
 * it still has to be given a job at the next payday; going out is paid for from
 * Enjoyment — which is what Enjoyment is for — and resets the depletion clock.
 *
 * Making is recorded and nothing else: it produces stock, and stock is §7's job.
 * The evening is spent either way, which is the part that matters here.
 */
export async function resolveEveningsUpTo(playerId: string, day: string): Promise<string[]> {
  const due = await q<EveningRow>(
    `SELECT id, player_id, week_id, slot, day::text AS day, kind, planned_cost,
            actual_cost, earned, taken_by, resolved_at
       FROM evening_plan
      WHERE player_id = $1 AND resolved_at IS NULL AND taken_by IS NULL AND day <= $2
      ORDER BY day, slot`,
    [playerId, day],
  );

  const notes: string[] = [];
  for (const ev of due) {
    if (ev.kind === "shift") {
      await post(playerId, ev.week_id, ev.day, "banked", ev.earned, null, "Extra shift");
      notes.push(`Extra shift on ${shortDay(ev.day)} — ${fmt(ev.earned)} banked until payday.`);
    } else if (ev.kind === "going_out") {
      const res = await debit(playerId, ev.week_id, ev.day, "enjoyment", ev.planned_cost, "Going out");
      await q(`UPDATE evening_plan SET actual_cost = $2 WHERE id = $1`, [ev.id, ev.planned_cost]);
      let line = `Going out on ${shortDay(ev.day)} cost ${fmt(ev.planned_cost)}.`;
      if (res.raided.length) {
        line += ` Enjoyment didn't cover it, so ${res.raided.map((t) => ENVELOPES[t].label).join(" and ")} made up the rest.`;
      }
      if (res.shortfall > 0) line += ` ${fmt(res.shortfall)} of it you simply couldn't pay.`;
      notes.push(line);
    } else if (ev.kind === "making") {
      notes.push(`${shortDay(ev.day)} was a making evening. Choose what to make on the Hustle screen.`);
    }
    await q(`UPDATE evening_plan SET resolved_at = now() WHERE id = $1`, [ev.id]);
  }

  if (due.some((e) => e.kind === "going_out")) await touchEnjoymentZero(playerId, day);
  return notes;
}

/**
 * A card takes an evening. Spec §6: "if a card takes an evening already
 * committed, show the player what they lost." So this returns the plan it
 * destroyed rather than quietly reassigning it.
 *
 * It takes the soonest unresolved evening, which is the one the player still
 * had. An evening already spent cannot be taken back.
 */
export async function takeEvening(
  playerId: string,
  day: string,
  by: string,
): Promise<{ taken: EveningRow | null; note: string | null }> {
  const next = await one<EveningRow>(
    `SELECT id, player_id, week_id, slot, day::text AS day, kind, planned_cost,
            actual_cost, earned, taken_by, resolved_at
       FROM evening_plan
      WHERE player_id = $1 AND resolved_at IS NULL AND taken_by IS NULL AND day >= $2
      ORDER BY day, slot LIMIT 1`,
    [playerId, day],
  );
  if (!next) return { taken: null, note: "That would have taken an evening, but you had none left to give." };

  await q(`UPDATE evening_plan SET taken_by = $2, resolved_at = now() WHERE id = $1`, [next.id, by]);

  const rule = EVENINGS[next.kind];
  if (next.kind === "nothing") {
    return { taken: next, note: `It took ${shortDay(next.day)} evening. You had nothing planned, so nothing was lost.` };
  }
  if (next.kind === "shift") {
    return { taken: next, note: `It took ${shortDay(next.day)} evening — the extra shift. That's ${fmt(rule.earns)} you won't see.` };
  }
  if (next.kind === "making") {
    return { taken: next, note: `It took ${shortDay(next.day)} evening. That was a making evening; the stock doesn't get made.` };
  }
  return { taken: next, note: `It took ${shortDay(next.day)} evening — you were going out.` };
}

/** "Monday", for talking about an evening rather than a date. */
function shortDay(iso: unknown): string {
  return new Date(`${isoDate(iso)}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    timeZone: "UTC",
  });
}

export { shortDay };

/* ------------------------------------------------------------------ season end */

/**
 * Once the last week has closed the season is over: every week gets its result and the status
 * becomes 'ended'. Safe to call any number of times, from the page or the cron.
 */
export async function endSeasonIfDone(seasonId: string, day: string): Promise<boolean> {
  const last = await one<{ closes_at: string | null }>(
    `SELECT MAX(closes_at) AS closes_at FROM week WHERE season_id = $1`, [seasonId],
  );
  if (!last?.closes_at || isoDate(last.closes_at) >= day) return false;

  const players = await q<{ id: string }>(
    `SELECT id FROM player WHERE season_id = $1 AND role = 'player'`, [seasonId],
  );
  const weeks = await q<WeekRow>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week WHERE season_id = $1 ORDER BY idx`, [seasonId],
  );
  for (const p of players) for (const w of weeks) await resolveWeek(p.id, w);
  await q(`UPDATE season SET status = 'ended' WHERE id = $1 AND status IN ('running','paused')`, [seasonId]);
  return true;
}
