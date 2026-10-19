"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { q, one } from "@/lib/db";
import { currentPlayer, endSession, startSession, verifyPin } from "@/lib/auth";
import { createSeason, currentSeason } from "@/lib/seed";
import { gbp, parsePounds } from "@/lib/money";
import { ALLOCATABLE_TYPES, type EnvelopeType } from "@/lib/envelopes";
import {
  addGoal, buyGoal, cardForPlayer, londonToday, paydayView, planEvenings, resolveCard,
  resolveEveningsUpTo, runPayday, syncGoalsEnvelope, weekFor,
} from "@/lib/engine";
import { EVENINGS_PER_WEEK } from "@/lib/evenings";
import { craftRule } from "@/lib/hustle-data";
import { answerAsk, startFundraiser } from "@/lib/asks";
import {
  acceptLoan, declineLoan, requestCommitmentChange, requestLoan, setCommittedCause, type Result,
} from "@/lib/loans";
import { buySupplies, decideSales, makeOn, pendingSales } from "@/lib/hustle";

/* ------------------------------------------------------------------- setup */

export async function createSeasonAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim() || "The Season";
  const startDate = String(formData.get("start_date") ?? "") || londonToday();
  const weeks = Number(formData.get("weeks") ?? 12);
  const frequency = String(formData.get("charity_frequency") ?? "normal") as
    "sparse" | "normal" | "generous";
  const paydayWeekday = Number(formData.get("payday_weekday") ?? 6);

  const players: Array<{ name: string; pin: string; role: "player" | "admin"; craft?: string; baseWage?: number }> = [];
  for (const slot of ["p1", "p2", "admin"]) {
    const pname = String(formData.get(`${slot}_name`) ?? "").trim();
    const pin = String(formData.get(`${slot}_pin`) ?? "").trim();
    if (!pname || !/^\d{4}$/.test(pin)) continue;
    players.push({
      name: pname,
      pin,
      role: slot === "admin" ? "admin" : "player",
      craft: String(formData.get(`${slot}_craft`) ?? "") || undefined,
      baseWage: parsePounds(String(formData.get(`${slot}_wage`) ?? "95")) ?? 9500,
    });
  }
  if (players.length < 2) return;

  await createSeason({ name, startDate, weeks, charityFrequency: frequency, paydayWeekday, players });
  redirect("/login");
}

/* -------------------------------------------------------------------- auth */

export async function loginAction(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "");
  const pin = String(formData.get("pin") ?? "");

  const season = await currentSeason();
  const player = await one<{ id: string; pin_hash: string }>(
    `SELECT id, pin_hash FROM player WHERE display_name = $1 AND season_id = $2`,
    [name, season?.id ?? null],
  );
  if (!player || !verifyPin(pin, player.pin_hash)) {
    redirect("/login?e=1");
  }
  await startSession(player.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

/* ------------------------------------------------------------ player setup */

export async function playerSetupAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");

  // Two or three real wants, with real prices. At least one is needed: the form shows
  // grey example text and it is easy to take that for a filled-in answer.
  let goalsGiven = 0;
  for (let i = 1; i <= 3; i++) {
    if (String(formData.get(`goal${i}_name`) ?? "").trim() && parsePounds(String(formData.get(`goal${i}_price`) ?? ""))) goalsGiven++;
  }
  if (goalsGiven === 0) {
    redirect(`/start?e=${encodeURIComponent("Add at least one goal with a name and a price. The grey words are only examples.")}`);
  }
  for (let i = 1; i <= 3; i++) {
    const gname = String(formData.get(`goal${i}_name`) ?? "").trim();
    const price = parsePounds(String(formData.get(`goal${i}_price`) ?? ""));
    if (!gname || !price) continue;
    await q(
      `INSERT INTO goal (player_id, name, target_amount) VALUES ($1,$2,$3)`,
      [me.id, gname, price],
    );
  }

  // Committed Giving: any amount including zero, locked for the season.
  const amount = parsePounds(String(formData.get("committed_amount") ?? "0")) ?? 0;
  const causeId = String(formData.get("cause_id") ?? "") || null;
  const customCause = String(formData.get("custom_cause") ?? "").trim();

  let finalCause = causeId;
  if (customCause) {
    const c = await one<{ id: string }>(
      `INSERT INTO cause (season_id, name, is_custom, created_by) VALUES ($1,$2,TRUE,$3) RETURNING id`,
      [me.season_id, customCause, me.id],
    );
    finalCause = c?.id ?? causeId;
  }

  await q(
    `UPDATE commitment SET amount = $2, cause_id = $3 WHERE player_id = $1`,
    [me.id, amount, finalCause],
  );

  const craft = String(formData.get("craft") ?? "").trim();
  await q(
    `UPDATE player SET setup_done = TRUE, craft = COALESCE(NULLIF($2,''), craft) WHERE id = $1`,
    [me.id, craft],
  );

  redirect("/");
}

/* ------------------------------------------------------------------ payday */

export async function paydayAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const day = londonToday();
  const view = await paydayView(me.id, season.id, day, me.base_wage, me.wage_variance);
  if (!view) redirect("/");

  const amounts: Partial<Record<EnvelopeType, number>> = {};
  for (const type of ALLOCATABLE_TYPES) {
    const raw = String(formData.get(`env_${type}`) ?? "").trim();
    if (!raw) continue;
    const pence = parsePounds(raw);
    if (pence === null) {
      redirect(`/payday?e=${encodeURIComponent("That isn't an amount I can read.")}`);
    }
    amounts[type] = pence;
  }

  // The evenings are validated BEFORE the money is moved. Half a payday — money
  // allocated, evenings not — would leave the week in a state the gate exists to
  // prevent, and runPayday has no undo.
  const kinds: string[] = [];
  for (let i = 1; i <= EVENINGS_PER_WEEK; i++) {
    kinds.push(String(formData.get(`evening_${i}`) ?? "").trim());
  }
  if (kinds.some((k) => !k)) {
    redirect(`/payday?e=${encodeURIComponent("All five evenings need a plan.")}`);
  }

  const result = await runPayday(me.id, view, day, amounts);
  if (!result.ok) {
    redirect(`/payday?e=${encodeURIComponent(result.error)}`);
  }

  const evenings = await planEvenings(me.id, view.week, kinds);
  if (!evenings.ok) {
    redirect(`/payday?e=${encodeURIComponent(evenings.error)}`);
  }

  // Planning late means some evenings have already been and gone.
  const eveningNotes = await resolveEveningsUpTo(me.id, day);

  revalidatePath("/");
  redirect(
    `/payday/done?n=${encodeURIComponent(JSON.stringify([...result.notes, ...eveningNotes]))}`,
  );
}

/* -------------------------------------------------------------- daily card */

export async function resolveCardAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const day = londonToday();
  const week = await weekFor(season.id, day);
  if (!week) redirect("/");

  const instId = String(formData.get("inst_id") ?? "");
  const cardId = String(formData.get("card_id") ?? "");
  const optionId = String(formData.get("option_id") ?? "");

  // Resolve against the card this player was actually shown, deck and wording included.
  const card = await cardForPlayer(cardId, me.deck_id, me.craft);
  if (!card) redirect("/");

  await resolveCard(me.id, week.id, day, instId, card, optionId);
  await syncGoalsEnvelope(me.id);

  revalidatePath("/");
  redirect("/");
}

/* ------------------------------------------------------------------ hustle */

function hustleBack(kind: "n" | "e", text: string): never {
  redirect(`/hustle?${kind}=${encodeURIComponent(text)}`);
}

export async function buySuppliesAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");
  const craft = craftRule(me.craft);
  if (!craft) redirect("/hustle");

  const day = londonToday();
  const week = await weekFor(season.id, day);
  if (!week) hustleBack("e", "The season isn't running today.");

  const count = Number(formData.get("count") ?? 1);
  const res = await buySupplies(me.id, week.id, day, craft, count);
  await syncGoalsEnvelope(me.id);
  revalidatePath("/hustle");
  if (!res.ok) hustleBack("e", res.error);
  hustleBack("n", res.message);
}

export async function makeAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const craft = craftRule(me.craft);
  if (!craft) redirect("/hustle");

  const eveningId = String(formData.get("evening_id") ?? "");
  const itemKey = String(formData.get("item") ?? "");
  const res = await makeOn(me.id, craft, eveningId, itemKey);
  revalidatePath("/hustle");
  if (!res.ok) hustleBack("e", res.error);
  hustleBack("n", res.message);
}

export async function decideSalesAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const day = londonToday();
  const week = await weekFor(season.id, day);

  const pending = await pendingSales(me.id);
  const decisions: Record<string, "me" | "giving" | "fundraiser"> = {};
  for (const s of pending) {
    const v = String(formData.get(`dest_${s.id}`) ?? "");
    if (v === "me" || v === "giving" || v === "fundraiser") decisions[s.id] = v;
  }
  // Every sale in the batch has to be decided, so nothing is chosen by omission.
  if (Object.keys(decisions).length !== pending.length) {
    hustleBack("e", "Each sale needs a decision.");
  }

  const { kept, given, raised } = await decideSales(me.id, week?.id ?? null, decisions);
  revalidatePath("/hustle");
  const parts: string[] = [];
  if (kept) parts.push(`${gbp(kept)} banked until payday`);
  if (given) parts.push(`${gbp(given)} to the Giving Reserve`);
  if (raised) parts.push(`${gbp(raised)} to your fundraiser`);
  hustleBack("n", parts.length ? `${parts.join(". ")}.` : "Nothing to decide.");
}

/* ------------------------------------------------------------------- goals */

export async function buyGoalAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const day = londonToday();
  const week = await weekFor(season.id, day);
  const res = await buyGoal(me.id, week?.id ?? null, day, String(formData.get("goal_id") ?? ""));
  revalidatePath("/");
  if (!res.ok) redirect(`/?ge=${encodeURIComponent(res.error)}`);
  redirect(`/?gn=${encodeURIComponent(`You bought ${res.name}. What's next?`)}`);
}

export async function addGoalAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");

  const price = parsePounds(String(formData.get("price") ?? ""));
  const res = await addGoal(me.id, String(formData.get("name") ?? ""), price ?? 0);
  revalidatePath("/");
  if (!res.ok) redirect(`/?ge=${encodeURIComponent(res.error)}`);
  redirect("/");
}

/* -------------------------------------------------------------------- asks */

export async function answerAskAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  // A suggested-amount button submits "amount"; the custom field submits "custom".
  // Declining submits an amount of 0. Anything that is not money counts as declining.
  const custom = String(formData.get("custom") ?? "").trim();
  const raw = String(formData.get("amount") ?? "") || custom;
  const amount = raw ? parsePounds(raw) ?? 0 : 0;

  const res = await answerAsk(me.id, season.id, londonToday(), String(formData.get("ask_id") ?? ""), amount);
  revalidatePath("/");
  redirect(`/?${res.ok ? "an" : "ae"}=${encodeURIComponent(res.ok ? res.message : res.error)}`);
}

export async function startFundraiserAction(formData: FormData): Promise<void> {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const res = await startFundraiser(me.id, season.id, londonToday(), {
    cause: String(formData.get("cause") ?? ""),
    why: String(formData.get("why") ?? ""),
    target: parsePounds(String(formData.get("target") ?? "")) ?? 0,
    method: String(formData.get("method") ?? "event"),
  });
  revalidatePath("/");
  redirect(`/?${res.ok ? "an" : "ae"}=${encodeURIComponent(res.ok ? res.message : res.error)}`);
}

/* ----------------------------------------------------------- account: loans etc. */

function accountBack(r: Result): never {
  revalidatePath("/account");
  redirect(`/account?${r.ok ? "m" : "e"}=${encodeURIComponent(r.ok ? r.message : r.error)}`);
}

async function player() {
  const me = await currentPlayer();
  if (!me || me.role !== "player") redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");
  return { me, season, day: londonToday() };
}

export async function requestLoanAction(formData: FormData): Promise<void> {
  const { me, day } = await player();
  const amount = parsePounds(String(formData.get("amount") ?? ""));
  accountBack(await requestLoan(me.id, day, amount ?? 0, String(formData.get("reason") ?? "")));
}

export async function acceptLoanAction(formData: FormData): Promise<void> {
  const { me, season, day } = await player();
  const week = await weekFor(season.id, day);
  const admin = await one<{ display_name: string }>(
    `SELECT display_name FROM player WHERE season_id = $1 AND role = 'admin' LIMIT 1`, [season.id],
  );
  accountBack(await acceptLoan(me.id, week?.id ?? null, day, String(formData.get("loan_id") ?? ""), admin?.display_name ?? "your parent"));
}

export async function declineOfferAction(formData: FormData): Promise<void> {
  const { day } = await player();
  accountBack(await declineLoan(String(formData.get("loan_id") ?? ""), day));
}

export async function requestCommitmentAction(formData: FormData): Promise<void> {
  const { me, day } = await player();
  const amount = parsePounds(String(formData.get("amount") ?? ""));
  if (amount == null) accountBack({ ok: false, error: "That isn't an amount." });
  accountBack(await requestCommitmentChange(me.id, day, amount));
}

export async function setCauseAction(formData: FormData): Promise<void> {
  const { me, season } = await player();
  accountBack(await setCommittedCause(me.id, season.id, String(formData.get("cause_id") ?? "")));
}
