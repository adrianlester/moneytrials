import "server-only";
import { q, one } from "./db";
import { addDays, credit, envelopeOf, isoDate, post, rng, weekFor } from "./engine";
import {
  ASK_CHANCE, CALENDAR_LOOKAHEAD_DAYS, SCHEDULED_ASKS, UNANNOUNCED_ASKS, UNANNOUNCED_OPEN_DAYS,
} from "./asks-data";
import { gbp } from "./money";

/**
 * Giving asks (spec section 8).
 *
 * Asks can only be met from the Giving Reserve, which is the one envelope this file
 * touches. It takes the balance directly rather than through debit(): debit() falls
 * back through the raidable envelopes, and an ask must never be paid out of Goals.
 *
 * Declining is a recorded answer. There is no penalty and no copy that leans on it.
 */

export interface AskRow {
  id: string;
  kind: "scheduled" | "unannounced" | "fundraiser";
  day: string;
  closes: string;
  cause: string;
  title: string;
  body: string;
  suggested: number[];
  /** Set on a fundraiser ask: who is raising, the target, and what has come in so far. */
  fundraiser?: { by: string; target: number; raised: number };
}

export interface SeasonForAsks {
  id: string;
  start_date: string;
  weeks: number;
  charity_frequency: "sparse" | "normal" | "generous";
}

/**
 * Lay out the whole season's asks. Seeded by season and week, so running it twice
 * (page load, cron, a second player) makes the same asks and the keys stop duplicates.
 * An unannounced ask is not shown until its day, so having a row early reveals nothing.
 */
export async function planAsks(season: SeasonForAsks, fromDay?: string): Promise<void> {
  // Laid out against the weeks as they are, so a paused and resumed season keeps its asks in step.
  const weeks = await q<{ idx: number; opens_at: string; closes_at: string }>(
    `SELECT idx, opens_at, closes_at FROM week WHERE season_id = $1 ORDER BY idx`, [season.id],
  );
  if (!weeks.length) return;
  const start = isoDate(weeks[0].opens_at);
  const end = isoDate(weeks[weeks.length - 1].closes_at);

  for (const wk of weeks) {
    const w = wk.idx - 1;
    const r = rng(`${season.id}:ask:${w}`);
    if (r() >= ASK_CHANCE[season.charity_frequency]) continue;
    const t = UNANNOUNCED_ASKS[Math.floor(r() * UNANNOUNCED_ASKS.length)];
    const day = addDays(isoDate(wk.opens_at), Math.floor(r() * 7));
    // Re-planning mid-season must not conjure asks for days that have already gone by.
    if (fromDay && day <= fromDay) continue;
    await insertAsk(season.id, `u${w}:${t.id}`, "unannounced", day, UNANNOUNCED_OPEN_DAYS, t);
  }

  // Scheduled: every calendar occurrence that falls inside the season.
  const firstYear = Number(start.slice(0, 4));
  for (const year of [firstYear, firstYear + 1]) {
    for (const s of SCHEDULED_ASKS) {
      const day = `${year}-${s.date}`;
      if (day < start || day > end) continue;
      await insertAsk(season.id, `s:${s.id}:${year}`, "scheduled", day, s.openDays, s);
    }
  }
}

/** For a season that existed before asks did: lay them out once, then do nothing. */
export async function ensureAsks(season: SeasonForAsks): Promise<void> {
  const have = await one(`SELECT 1 AS x FROM ask WHERE season_id = $1 LIMIT 1`, [season.id]);
  if (!have) await planAsks(season);
}

async function insertAsk(
  seasonId: string, key: string, kind: "scheduled" | "unannounced", day: string, openDays: number,
  t: { cause: string; title: string; body: string; suggested: number[] },
): Promise<void> {
  await q(
    `INSERT INTO ask (season_id, key, kind, day, closes, cause, title, body, suggested)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (season_id, key) DO NOTHING`,
    [seasonId, key, kind, day, addDays(day, openDays), t.cause, t.title, t.body, JSON.stringify(t.suggested)],
  );
}

function rowOf(r: Record<string, unknown>): AskRow {
  return {
    id: String(r.id),
    kind: r.kind as AskRow["kind"],
    day: isoDate(r.day),
    closes: isoDate(r.closes),
    cause: String(r.cause),
    title: String(r.title),
    body: String(r.body),
    suggested: JSON.parse(String(r.suggested)) as number[],
  };
}

/** Asks that have arrived, are still open, and this player has not answered. */
export async function openAsks(playerId: string, seasonId: string, day: string): Promise<AskRow[]> {
  const rows = await q(
    `SELECT a.*, f.target AS f_target, p.display_name AS f_by,
            (SELECT COALESCE(SUM(amount_given), 0) FROM ask_response x WHERE x.ask_id = a.id)
          + (SELECT COALESCE(SUM(price), 0) FROM stock_item s WHERE s.fundraiser_id = f.id)
          + (SELECT COALESCE(SUM(amount), 0) FROM fundraiser_match m WHERE m.fundraiser_id = f.id) AS f_raised
       FROM ask a
       LEFT JOIN fundraiser f ON f.ask_id = a.id
       LEFT JOIN player p ON p.id = a.from_player
      WHERE a.season_id = $1 AND a.day <= $2 AND a.closes >= $2
        AND (a.from_player IS NULL OR a.from_player <> $3)
        AND NOT EXISTS (SELECT 1 FROM ask_response r WHERE r.ask_id = a.id AND r.player_id = $3)
      ORDER BY a.day, a.key`,
    [seasonId, day, playerId],
  );
  return rows.map((r) => ({
    ...rowOf(r),
    ...(r.f_target != null
      ? { fundraiser: { by: String(r.f_by), target: Number(r.f_target), raised: Number(r.f_raised) } }
      : {}),
  }));
}

/** The calendar strip: scheduled asks still to come, so a player can save toward them. */
export async function upcomingScheduled(seasonId: string, day: string): Promise<AskRow[]> {
  const rows = await q(
    `SELECT * FROM ask WHERE season_id = $1 AND kind = 'scheduled' AND day > $2 AND day <= $3
      ORDER BY day`,
    [seasonId, day, addDays(day, CALENDAR_LOOKAHEAD_DAYS)],
  );
  return rows.map(rowOf);
}

export type AskResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Answer an ask with `amount` pence (0 declines). The amount is limited to what the
 * Giving Reserve holds; giving less than asked is allowed.
 */
export async function answerAsk(
  playerId: string, seasonId: string, day: string, askId: string, amount: number,
): Promise<AskResult> {
  const ask = await one<Record<string, unknown>>(
    `SELECT * FROM ask WHERE id = $1 AND season_id = $2`, [askId, seasonId],
  );
  if (!ask) return { ok: false, error: "That ask isn't there any more." };
  const a = rowOf(ask);
  if (a.day > day || a.closes < day) return { ok: false, error: "That ask is not open." };

  const done = await one(`SELECT 1 AS x FROM ask_response WHERE ask_id = $1 AND player_id = $2`, [askId, playerId]);
  if (done) return { ok: false, error: "You have already answered that one." };

  const reserve = await envelopeOf(playerId, "giving_reserve");
  const give = Math.max(0, Math.min(Math.round(amount), reserve.balance));
  const week = await weekFor(seasonId, day);

  if (give > 0) {
    await credit(reserve.id, -give);
    await post(playerId, week?.id ?? null, day, "gift", -give, reserve.id, `Gave to ${a.cause}`);
  }
  await q(
    `INSERT INTO ask_response (ask_id, player_id, amount_given) VALUES ($1,$2,$3)`,
    [askId, playerId, give],
  );

  if (give === 0) return { ok: true, message: `Not this time. Your Giving Reserve is still ${gbp(reserve.balance)}.` };
  const short = amount > reserve.balance ? " That was all the Reserve had." : "";
  return { ok: true, message: `You gave ${gbp(give)} to ${a.cause}.${short} Giving Reserve: ${gbp(reserve.balance - give)}.` };
}

/* -------------------------------------------------------------- fundraisers */

/** How long a fundraiser stays open to sponsors. */
export const FUNDRAISER_DAYS = 7;

export interface FundraiserView {
  id: string;
  cause: string;
  why: string;
  target: number;
  raised: number;
  method: "event" | "sales";
  startedOn: string;
  closes: string;
  open: boolean;
  /** Of the raised total, how much came from the owner's own sales. */
  fromSales: number;
  /** Added by the admin. */
  matched: number;
  sponsors: Array<{ name: string; amount: number }>;
}

/**
 * Declare a fundraiser. One at a time per player. It reaches the other players as an ask
 * and they may sponsor from their own Giving Reserve. This is the only place the two
 * economies touch, so it never moves the owner's money.
 */
export async function startFundraiser(
  playerId: string, seasonId: string, day: string,
  input: { cause: string; why: string; target: number; method: string },
): Promise<AskResult> {
  const cause = input.cause.trim().slice(0, 80);
  const why = input.why.trim().slice(0, 240);
  if (!cause) return { ok: false, error: "Say what you are raising money for." };
  if (!(input.target > 0)) return { ok: false, error: "Put in a target amount." };
  const method = input.method === "sales" ? "sales" : "event";

  const live = await myFundraiser(playerId, day);
  if (live?.open) return { ok: false, error: "You already have a fundraiser running." };

  const me = await one<{ display_name: string }>(`SELECT display_name FROM player WHERE id = $1`, [playerId]);
  const how = method === "sales" ? "selling things to raise it" : "doing a sponsored event";
  const ask = await one<{ id: string }>(
    `INSERT INTO ask (season_id, key, kind, day, closes, cause, title, body, suggested, from_player)
     VALUES ($1,$2,'fundraiser',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      seasonId, `f:${playerId}:${day}`, day, addDays(day, FUNDRAISER_DAYS), cause,
      `${me?.display_name ?? "Someone"}'s fundraiser`,
      `${me?.display_name ?? "Someone"} is ${how} for ${cause}.${why ? " " + why : ""}`,
      JSON.stringify([100, 200, 500]), playerId,
    ],
  );
  if (!ask) return { ok: false, error: "That didn't save. Try again." };
  await q(
    `INSERT INTO fundraiser (season_id, player_id, ask_id, cause, why, target, method, started_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [seasonId, playerId, ask.id, cause, why, Math.round(input.target), method, day],
  );
  return { ok: true, message: `Your fundraiser for ${cause} is open for ${FUNDRAISER_DAYS} days.` };
}

/** The player's most recent fundraiser, with who has sponsored it. */
export async function myFundraiser(playerId: string, day: string): Promise<FundraiserView | null> {
  const f = await one<Record<string, unknown>>(
    `SELECT f.*, a.closes FROM fundraiser f JOIN ask a ON a.id = f.ask_id
      WHERE f.player_id = $1 ORDER BY f.started_on DESC LIMIT 1`,
    [playerId],
  );
  if (!f) return null;
  const sponsors = await q<{ name: string; amount: number }>(
    `SELECT p.display_name AS name, r.amount_given AS amount
       FROM ask_response r JOIN player p ON p.id = r.player_id
      WHERE r.ask_id = $1 AND r.amount_given > 0 ORDER BY r.responded_at`,
    [String(f.ask_id)],
  );
  const closes = isoDate(f.closes);
  const sales = await one<{ n: string | number }>(
    `SELECT COALESCE(SUM(price), 0) AS n FROM stock_item WHERE fundraiser_id = $1`, [String(f.id)],
  );
  const fromSales = Number(sales?.n ?? 0);
  const m = await one<{ n: string | number }>(
    `SELECT COALESCE(SUM(amount), 0) AS n FROM fundraiser_match WHERE fundraiser_id = $1`, [String(f.id)],
  );
  const matched = Number(m?.n ?? 0);
  return {
    id: String(f.id),
    cause: String(f.cause),
    why: String(f.why),
    target: Number(f.target),
    raised: sponsors.reduce((n, s) => n + Number(s.amount), 0) + fromSales + matched,
    fromSales,
    matched,
    method: f.method as "event" | "sales",
    startedOn: isoDate(f.started_on),
    closes,
    open: closes >= day,
    sponsors: sponsors.map((s) => ({ name: s.name, amount: Number(s.amount) })),
  };
}
