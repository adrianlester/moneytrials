import "server-only";
import fs from "node:fs";
import path from "node:path";
import { q, one } from "./db";
import { ALL_TYPES, ENVELOPES } from "./envelopes";
import { hashPin } from "./auth";
import { buildWeeks } from "./engine";
import { planAsks } from "./asks";

interface DeckFile {
  deck_id: string;
  cards: Array<{
    id: string;
    kind: "dilemma" | "event";
    weight: number;
    title: string;
    body: string;
    season_window?: string;
    options: unknown[];
    variants?: Record<string, unknown>;
  }>;
}

/** Cards are seeded from JSON so the deck can be regenerated and tuned between seasons. */
export async function loadDeck(): Promise<number> {
  const file = path.join(process.cwd(), "src", "content", "deck.json");
  const deck = JSON.parse(fs.readFileSync(file, "utf8")) as DeckFile;

  for (const c of deck.cards) {
    await q(
      `INSERT INTO event_card (id, deck_id, kind, title, body, options_json, weight, season_window, variants_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         deck_id = EXCLUDED.deck_id, kind = EXCLUDED.kind, title = EXCLUDED.title,
         body = EXCLUDED.body, options_json = EXCLUDED.options_json,
         weight = EXCLUDED.weight, season_window = EXCLUDED.season_window,
         variants_json = EXCLUDED.variants_json`,
      [
        c.id, deck.deck_id, c.kind, c.title, c.body,
        JSON.stringify(c.options), c.weight, c.season_window ?? null,
        c.variants ? JSON.stringify(c.variants) : null,
      ],
    );
  }
  return deck.cards.length;
}

const SEED_CAUSES = [
  "Local food bank",
  "Tearfund",
  "Air ambulance",
  "Church",
];

export async function currentSeason(): Promise<{ id: string; name: string; start_date: string; weeks: number; status: string; payday_weekday: number; charity_frequency: "sparse" | "normal" | "generous"; paused_on: string | null } | null> {
  return one(
    `SELECT id, name, start_date, weeks, status, payday_weekday, charity_frequency, paused_on
       FROM season WHERE status IN ('setup','running','paused','ended')
       ORDER BY created_at DESC LIMIT 1`,
  );
}

export interface NewPlayer {
  name: string;
  pin: string;
  role: "player" | "admin";
  craft?: string | null;
  baseWage?: number;
}

export async function createSeason(opts: {
  name: string;
  startDate: string;
  weeks: number;
  charityFrequency: "sparse" | "normal" | "generous";
  paydayWeekday: number;
  players: NewPlayer[];
}): Promise<string> {
  await loadDeck();

  const season = await one<{ id: string }>(
    `INSERT INTO season (name, start_date, weeks, charity_frequency, payday_weekday, status)
     VALUES ($1,$2,$3,$4,$5,'running') RETURNING id`,
    [opts.name, opts.startDate, opts.weeks, opts.charityFrequency, opts.paydayWeekday],
  );
  if (!season) throw new Error("season not created");

  await buildWeeks(season.id, opts.startDate, opts.weeks);
  await planAsks({ id: season.id, start_date: opts.startDate, weeks: opts.weeks, charity_frequency: opts.charityFrequency });

  for (const name of SEED_CAUSES) {
    await q(`INSERT INTO cause (season_id, name, is_custom) VALUES ($1,$2,FALSE)`, [season.id, name]);
  }

  for (const p of opts.players) {
    const player = await one<{ id: string }>(
      `INSERT INTO player (season_id, display_name, pin_hash, role, craft, base_wage)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [season.id, p.name, hashPin(p.pin), p.role, p.craft ?? null, p.baseWage ?? 9500],
    );
    if (!player) continue;

    for (const type of ALL_TYPES) {
      const rule = ENVELOPES[type];
      await q(
        `INSERT INTO envelope (player_id, type, balance, locked, raidable, rolls_over)
         VALUES ($1,$2,0,$3,$4,$5) ON CONFLICT (player_id, type) DO NOTHING`,
        [player.id, type, type === "bills", rule.raidable, rule.rollsOver],
      );
    }

    await q(
      `INSERT INTO commitment (player_id, amount) VALUES ($1, 0)
       ON CONFLICT (player_id) DO NOTHING`,
      [player.id],
    );
  }

  return season.id;
}

export async function causesFor(seasonId: string): Promise<Array<{ id: string; name: string }>> {
  return q<{ id: string; name: string }>(
    `SELECT id, name FROM cause WHERE season_id = $1 ORDER BY is_custom, name`,
    [seasonId],
  );
}
