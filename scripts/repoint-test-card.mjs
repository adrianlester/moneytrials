// Test harness: repoint today's dealt card at a takesEvening card so the §6
// mechanic can be exercised end to end in the browser. Throwaway test DB only.
import { PGlite } from "@electric-sql/pglite";
const dir = process.argv[2];
const target = process.argv[3];
const pg = new PGlite(dir);
const today = new Date().toISOString().slice(0, 10);
await pg.query(
  `UPDATE event_inst SET card_id = $1, choice = NULL, outcome_json = NULL, resolved_at = NULL WHERE day = $2`,
  [target, today],
);
const r = await pg.query(
  `SELECT p.display_name, ei.card_id, ei.choice FROM event_inst ei JOIN player p ON p.id = ei.player_id WHERE ei.day = $1`,
  [today],
);
console.log(today, JSON.stringify(r.rows));
const ev = await pg.query(
  `SELECT p.display_name, e.slot, e.day::text AS day, e.kind, e.planned_cost, e.taken_by, e.resolved_at
     FROM evening_plan e JOIN player p ON p.id = e.player_id ORDER BY p.display_name, e.slot`,
);
console.table(ev.rows);
await pg.close();
