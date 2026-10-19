import "server-only";
import { q } from "./db";
import {
  checkEnjoymentDepletion, dealCard, endSeasonIfDone, londonToday, resolveEveningsUpTo, resolveWeek, weekFor,
  type WeekRow,
} from "./engine";
import { craftRule } from "./hustle-data";
import { resolveMarkets } from "./hustle";

/**
 * The day-rollover job. Everything the home page does lazily on arrival (close the
 * weeks that have finished, resolve evenings and markets that have come round, let
 * the Enjoyment clock fire, deal today's card) done for every player, so a day
 * nobody opens the app still happens.
 *
 * It is safe to run twice, and safe to run alongside a player arriving: each step
 * is seeded or guarded, which is what makes lazy dealing and a cron compatible.
 *
 * What the player would have been told on arrival is kept as notices and shown on
 * their next visit, otherwise the cron would quietly swallow it.
 */

interface PlayerRow {
  id: string;
  display_name: string;
  season_id: string;
  craft: string | null;
  deck_id: string | null;
  payday_weekday: number;
}

async function notify(playerId: string, day: string, texts: string[]): Promise<void> {
  for (const text of texts) {
    await q(`INSERT INTO notice (player_id, day, text) VALUES ($1,$2,$3)`, [playerId, day, text]);
  }
}

export async function rolloverPlayer(p: PlayerRow, day: string): Promise<string[]> {
  const week = await weekFor(p.season_id, day);

  // Closed before the "no week today" exit, so the last week of a season still
  // gets its result on the first run after it ends.
  const finished = await q<WeekRow>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week
      WHERE season_id = $1 AND closes_at < $2 ORDER BY idx`,
    [p.season_id, day],
  );
  for (const w of finished) await resolveWeek(p.id, w);
  if (!week) return [];

  const notes = await resolveEveningsUpTo(p.id, day);

  const craft = craftRule(p.craft);
  if (craft) {
    notes.push(...(await resolveMarkets(p.id, craft, p.season_id, p.payday_weekday, day)));
  }

  const depletion = await checkEnjoymentDepletion(p.id, week.id, day);
  if (depletion) notes.push(depletion);

  await dealCard(p.id, p.deck_id ?? "standard", week.id, day, p.craft);

  await notify(p.id, day, notes);
  return notes;
}

export async function rolloverAll(day = londonToday()): Promise<{ day: string; players: number; notices: number }> {
  const players = await q<PlayerRow>(
    `SELECT p.id, p.display_name, p.season_id, p.craft, p.deck_id, s.payday_weekday
       FROM player p JOIN season s ON s.id = p.season_id
      WHERE p.role = 'player' AND s.status = 'running'`,
  );
  let notices = 0;
  for (const p of players) notices += (await rolloverPlayer(p, day)).length;
  for (const s of await q<{ id: string }>(`SELECT id FROM season WHERE status = 'running'`)) {
    await endSeasonIfDone(s.id, day);
  }
  return { day, players: players.length, notices };
}

export async function takeNotices(playerId: string): Promise<string[]> {
  const rows = await q<{ id: string; text: string }>(
    `SELECT id, text FROM notice WHERE player_id = $1 AND seen_at IS NULL ORDER BY created_at`,
    [playerId],
  );
  if (rows.length) {
    await q(`UPDATE notice SET seen_at = now() WHERE player_id = $1 AND seen_at IS NULL`, [playerId]);
  }
  return rows.map((r) => r.text);
}
