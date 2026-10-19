import "server-only";
import { q, one } from "./db";
import { isoDate } from "./engine";

/**
 * The season-end report (spec section 9). Three separate things and no total: Survival, Goals,
 * Given. Giving is reported, never scored. A player who gave nothing is told so, in the same
 * plain voice as everything else.
 */

export interface Report {
  name: string;
  weeksPlayed: number;
  survival: {
    weeksSurvived: number;
    weeksFailed: number;
    longestStreak: number;
    obligationsFailed: number;
    failedWeeks: Array<{ week: number; why: string[] }>;
  };
  goals: Array<{ name: string; price: number; saved: number; status: "bought" | "reached" | "open"; when: string | null }>;
  given: {
    total: number;
    committed: number;
    asks: number;
    fundraiser: number;
    byRecipient: Array<{ to: string; amount: number }>;
    reserveLeft: number;
    raised: Array<{ cause: string; target: number; raised: number; matched: number }>;
  };
}

function recipient(type: string, note: string): string {
  if (type === "committed_giving") {
    const i = note.indexOf(" — ");
    return i >= 0 ? note.slice(i + 3) : "Committed Giving";
  }
  return note.startsWith("Gave to ") ? note.slice("Gave to ".length) : note || "Gift";
}

export async function seasonReport(playerId: string): Promise<Report> {
  const p = await one<{ display_name: string }>(`SELECT display_name FROM player WHERE id = $1`, [playerId]);

  const results = await q<{ idx: number; survived: boolean; failures: string; streak: number }>(
    `SELECT w.idx, r.survived, r.failures, r.streak FROM week_result r JOIN week w ON w.id = r.week_id
      WHERE r.player_id = $1 ORDER BY w.idx`,
    [playerId],
  );
  const failedWeeks = results
    .filter((r) => !r.survived)
    .map((r) => ({ week: r.idx, why: JSON.parse(r.failures || "[]") as string[] }));
  const unpaid = await one<{ n: number | string }>(
    `SELECT COUNT(*) AS n FROM ledger WHERE player_id = $1 AND type = 'unpaid_obligation'`, [playerId],
  );

  const goalRows = await q<{ name: string; target_amount: number; saved_amount: number; reached_at: string | null; bought_at: string | null }>(
    `SELECT name, target_amount, saved_amount, reached_at, bought_at FROM goal WHERE player_id = $1 ORDER BY created_at`, [playerId],
  );

  const gifts = await q<{ type: string; amount: number; note: string }>(
    `SELECT type, amount, note FROM ledger WHERE player_id = $1 AND type IN ('committed_giving','gift')`, [playerId],
  );
  const by = new Map<string, number>();
  let committed = 0, asks = 0, fundraiser = 0; // asks counts every gift for now; own-fundraiser sales are split out below
  for (const g of gifts) {
    const amt = Math.abs(g.amount);
    if (g.type === "committed_giving") committed += amt;
    else asks += amt;
    const to = recipient(g.type, g.note);
    by.set(to, (by.get(to) ?? 0) + amt);
  }
  // Money sent to a fundraiser from a sale is a gift too; it is tagged by its own sale row.
  const saleGifts = await one<{ n: number | string }>(
    `SELECT COALESCE(SUM(price),0) AS n FROM stock_item WHERE player_id = $1 AND fundraiser_id IS NOT NULL`, [playerId],
  );
  fundraiser += Number(saleGifts?.n ?? 0);
  asks -= Number(saleGifts?.n ?? 0);

  const reserve = await one<{ balance: number }>(
    `SELECT balance FROM envelope WHERE player_id = $1 AND type = 'giving_reserve'`, [playerId],
  );

  const raised = await q<{ cause: string; target: number; raised: number; matched: number }>(
    `SELECT f.cause, f.target,
            (SELECT COALESCE(SUM(amount_given),0) FROM ask_response r WHERE r.ask_id = f.ask_id)
          + (SELECT COALESCE(SUM(price),0) FROM stock_item s WHERE s.fundraiser_id = f.id)
          + (SELECT COALESCE(SUM(amount),0) FROM fundraiser_match m WHERE m.fundraiser_id = f.id) AS raised,
            (SELECT COALESCE(SUM(amount),0) FROM fundraiser_match m WHERE m.fundraiser_id = f.id) AS matched
       FROM fundraiser f WHERE f.player_id = $1 ORDER BY f.started_on`,
    [playerId],
  );

  const total = committed + asks + fundraiser;
  return {
    name: p?.display_name ?? "",
    weeksPlayed: results.length,
    survival: {
      weeksSurvived: results.filter((r) => r.survived).length,
      weeksFailed: failedWeeks.length,
      longestStreak: results.reduce((m, r) => Math.max(m, r.streak), 0),
      obligationsFailed: Number(unpaid?.n ?? 0),
      failedWeeks,
    },
    goals: goalRows.map((g) => ({
      name: g.name,
      price: g.target_amount,
      saved: g.saved_amount,
      status: g.bought_at ? "bought" : g.reached_at ? "reached" : "open",
      when: g.bought_at ? isoDate(g.bought_at) : g.reached_at ? isoDate(g.reached_at) : null,
    })),
    given: {
      total,
      committed,
      asks,
      fundraiser,
      byRecipient: [...by.entries()].map(([to, amount]) => ({ to, amount })).sort((a, b) => b.amount - a.amount),
      reserveLeft: reserve?.balance ?? 0,
      raised: raised.map((r) => ({ cause: r.cause, target: Number(r.target), raised: Number(r.raised), matched: Number(r.matched) })),
    },
  };
}
