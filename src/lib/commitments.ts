import "server-only";
import { q, one } from "./db";
import { post } from "./engine";
import { gbp } from "./money";

/**
 * Committed Giving changes (spec sections 5 and 10). The cause can change any time; the
 * amount is locked for the season and a change needs the admin's approval.
 */

export type Result = { ok: true; message: string } | { ok: false; error: string };

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
