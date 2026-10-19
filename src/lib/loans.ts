import "server-only";
import { q, one } from "./db";
import { post } from "./engine";
import { gbp } from "./money";

/**
 * Loans and Committed Giving changes (spec sections 5 and 10).
 *
 * A loan moves requested -> offered -> active -> repaid. The admin sets the terms, the player
 * reads them in plain text and accepts before any money lands, and a player can turn the terms
 * down. The money arrives the way any other mid-week income does: banked until the next payday,
 * so it still has to be given a job. There is no interest.
 *
 * Repayment comes out at payday before anything is allocated (see paydayView in engine.ts). A
 * repayment that cannot be covered fails the week and stays owing.
 */

export interface LoanRow {
  id: string;
  player_id: string;
  status: "requested" | "offered" | "active" | "repaid" | "declined";
  asked_amount: number;
  reason: string;
  principal: number;
  weekly_repayment: number;
  weeks: number;
  outstanding: number;
  requested_on: string;
}

const COLS = `id, player_id, status, asked_amount, reason, principal, weekly_repayment, weeks,
              outstanding, requested_on::text AS requested_on`;

export type Result = { ok: true; message: string } | { ok: false; error: string };

/** The terms exactly as the player will read them. */
export function loanTerms(l: { principal: number; weekly_repayment: number; weeks: number }, adminName: string): string {
  return (
    `You get ${gbp(l.principal)} from ${adminName}. It arrives with your next wage, so it still has to be given a job. ` +
    `You pay back ${gbp(l.weekly_repayment)} a week for up to ${l.weeks} weeks. ` +
    `It comes out at payday before you allocate anything, the same way Committed Giving does. ` +
    `There is no interest. If a payment can't be covered, that week counts as failed and the amount is still owed.`
  );
}

/** The player's latest loan that is still live, or the most recent one if none are. */
export async function currentLoan(playerId: string): Promise<LoanRow | null> {
  const live = await one<LoanRow>(
    `SELECT ${COLS} FROM loan WHERE player_id = $1 AND status IN ('requested','offered','active')
      ORDER BY requested_on DESC LIMIT 1`,
    [playerId],
  );
  if (live) return live;
  return one<LoanRow>(`SELECT ${COLS} FROM loan WHERE player_id = $1 ORDER BY requested_on DESC LIMIT 1`, [playerId]);
}

export async function requestLoan(playerId: string, day: string, amount: number, reason: string): Promise<Result> {
  if (!(amount > 0)) return { ok: false, error: "Put in how much you want." };
  const live = await one(`SELECT 1 AS x FROM loan WHERE player_id = $1 AND status IN ('requested','offered','active')`, [playerId]);
  if (live) return { ok: false, error: "You already have a loan open." };
  await q(
    `INSERT INTO loan (player_id, asked_amount, reason, requested_on) VALUES ($1,$2,$3,$4)`,
    [playerId, Math.round(amount), reason.trim().slice(0, 240), day],
  );
  return { ok: true, message: "Asked. You'll see the terms here when they come back." };
}

/** Admin: set the terms on a request. */
export async function offerLoan(
  loanId: string, day: string, principal: number, weekly: number, weeks: number,
): Promise<Result> {
  if (!(principal > 0) || !(weekly > 0) || !(weeks > 0)) return { ok: false, error: "Amount, weekly repayment and weeks are all needed." };
  if (weekly * weeks < principal) return { ok: false, error: "That doesn't pay the loan back in that many weeks." };
  const l = await one<{ status: string }>(`SELECT status FROM loan WHERE id = $1`, [loanId]);
  if (!l || l.status !== "requested") return { ok: false, error: "That request isn't waiting for terms." };
  await q(
    `UPDATE loan SET status = 'offered', principal = $2, weekly_repayment = $3, weeks = $4,
            outstanding = $2, decided_on = $5 WHERE id = $1`,
    [loanId, Math.round(principal), Math.round(weekly), Math.round(weeks), day],
  );
  return { ok: true, message: "Terms sent." };
}

/** Admin declining a request, or a player turning down the terms. */
export async function declineLoan(loanId: string, day: string): Promise<Result> {
  const n = await q(
    `UPDATE loan SET status = 'declined', decided_on = $2 WHERE id = $1 AND status IN ('requested','offered') RETURNING id`,
    [loanId, day],
  );
  return n.length ? { ok: true, message: "Declined." } : { ok: false, error: "That one can't be declined now." };
}

/** Player: accept the terms. The principal is banked until the next payday. */
export async function acceptLoan(playerId: string, weekId: string | null, day: string, loanId: string, adminName: string): Promise<Result> {
  const l = await one<LoanRow>(`SELECT ${COLS} FROM loan WHERE id = $1 AND player_id = $2`, [loanId, playerId]);
  if (!l || l.status !== "offered") return { ok: false, error: "There are no terms to accept." };
  await q(`UPDATE loan SET status = 'active', accepted_on = $2 WHERE id = $1`, [loanId, day]);
  await post(playerId, weekId, day, "banked", l.principal, null, `Loan from ${adminName}, banked until payday`);
  return { ok: true, message: `Loan of ${gbp(l.principal)} accepted. It arrives with your next wage.` };
}

/* ------------------------------------------------------------ committed giving */

export interface CommitmentRequest {
  id: string;
  player_id: string;
  new_amount: number;
  status: "pending" | "approved" | "declined";
  requested_on: string;
}

export async function pendingCommitmentRequest(playerId: string): Promise<CommitmentRequest | null> {
  return one<CommitmentRequest>(
    `SELECT id, player_id, new_amount, status, requested_on::text AS requested_on
       FROM commitment_request WHERE player_id = $1 AND status = 'pending'`,
    [playerId],
  );
}

export async function requestCommitmentChange(playerId: string, day: string, amount: number): Promise<Result> {
  if (amount < 0) return { ok: false, error: "That isn't an amount." };
  const cur = await one<{ amount: number }>(`SELECT amount FROM commitment WHERE player_id = $1`, [playerId]);
  if (cur && cur.amount === amount) return { ok: false, error: "That is what it already is." };
  if (await pendingCommitmentRequest(playerId)) return { ok: false, error: "A change is already waiting." };
  await q(`INSERT INTO commitment_request (player_id, new_amount, requested_on) VALUES ($1,$2,$3)`, [playerId, Math.round(amount), day]);
  return { ok: true, message: "Asked. It changes from the next payday if it is approved." };
}

export async function decideCommitment(requestId: string, approve: boolean, day: string): Promise<Result> {
  const r = await one<{ player_id: string; new_amount: number }>(
    `UPDATE commitment_request SET status = $2, decided_on = $3
      WHERE id = $1 AND status = 'pending' RETURNING player_id, new_amount`,
    [requestId, approve ? "approved" : "declined", day],
  );
  if (!r) return { ok: false, error: "That request isn't waiting." };
  if (approve) await q(`UPDATE commitment SET amount = $2 WHERE player_id = $1`, [r.player_id, r.new_amount]);
  return { ok: true, message: approve ? "Approved." : "Declined." };
}

/** The cause can change whenever the player likes. Only the amount needs approval. */
export async function setCommittedCause(playerId: string, seasonId: string, causeId: string): Promise<Result> {
  const c = await one(`SELECT 1 AS x FROM cause WHERE id = $1 AND season_id = $2`, [causeId, seasonId]);
  if (!c) return { ok: false, error: "That cause isn't on the list." };
  await q(`UPDATE commitment SET cause_id = $2 WHERE player_id = $1`, [playerId, causeId]);
  return { ok: true, message: "Cause changed." };
}
