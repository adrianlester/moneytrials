"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { parsePounds } from "@/lib/money";
import { londonToday } from "@/lib/engine";
import {
  buildTierDeck, createCard, extendSeason, matchFundraiser, pauseSeason, removeOverride, resumeSeason,
  saveCard, setAskFrequency, setCardEnabled, setPlayerDeck, setPlayerWage, type Result,
} from "@/lib/admin";
import { decideCommitment } from "@/lib/commitments";

/** Every admin action starts here. A player who finds one of these URLs gets bounced home. */
async function admin() {
  const me = await currentPlayer();
  if (!me || me.role !== "admin") redirect("/");
  const season = await currentSeason();
  if (!season) redirect("/setup");
  return { me, season, day: londonToday() };
}

function back(to: string, r: Result): never {
  revalidatePath("/admin", "layout");
  const sep = to.includes("?") ? "&" : "?";
  redirect(`${to}${sep}${r.ok ? "m" : "e"}=${encodeURIComponent(r.ok ? r.message : r.error)}`);
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

/* ------------------------------------------------------------------- season */

export async function pauseAction(): Promise<void> {
  const { season, day } = await admin();
  back("/admin", await pauseSeason(season.id, day));
}

export async function resumeAction(): Promise<void> {
  const { season, day } = await admin();
  back("/admin", await resumeSeason(season.id, day));
}

export async function extendAction(f: FormData): Promise<void> {
  const { season } = await admin();
  back("/admin", await extendSeason(season.id, Number(str(f, "weeks"))));
}

export async function frequencyAction(f: FormData): Promise<void> {
  const { season, day } = await admin();
  back("/admin", await setAskFrequency(season.id, str(f, "frequency"), day));
}

/* ------------------------------------------------------------------ players */

export async function playerAction(f: FormData): Promise<void> {
  await admin();
  const id = str(f, "player_id");
  const wage = parsePounds(str(f, "wage"));
  if (wage == null) back("/admin", { ok: false, error: "That wage isn't an amount." });
  const w = await setPlayerWage(id, wage, f.get("variance") === "on");
  if (!w.ok) back("/admin", w);
  back("/admin", await setPlayerDeck(id, str(f, "deck")));
}

export async function buildDeckAction(f: FormData): Promise<void> {
  await admin();
  back("/admin", await buildTierDeck(str(f, "deck"), Number(str(f, "factor"))));
}

export async function commitmentDecisionAction(f: FormData): Promise<void> {
  const { day } = await admin();
  back("/admin", await decideCommitment(str(f, "request_id"), str(f, "decision") === "approve", day));
}

/* ------------------------------------------------------------- fundraisers */

export async function matchAction(f: FormData): Promise<void> {
  const { day } = await admin();
  const amount = parsePounds(str(f, "amount"));
  if (amount == null) back("/admin", { ok: false, error: "That isn't an amount." });
  back("/admin", await matchFundraiser(str(f, "fundraiser_id"), amount, day));
}

/* -------------------------------------------------------------------- cards */

export async function saveCardAction(f: FormData): Promise<void> {
  await admin();
  const id = str(f, "id");
  const deck = str(f, "deck") || "standard";
  const r = await saveCard(id, deck, {
    kind: str(f, "kind"), title: str(f, "title"), body: str(f, "body"), weight: Number(str(f, "weight")),
    season_window: str(f, "season_window"), options_json: str(f, "options_json"),
  });
  back(`/admin/cards/${encodeURIComponent(id)}?deck=${encodeURIComponent(deck)}`, r);
}

export async function createCardAction(f: FormData): Promise<void> {
  await admin();
  const r = await createCard({
    id: str(f, "id"), kind: str(f, "kind"), title: str(f, "title"), body: str(f, "body"),
    weight: Number(str(f, "weight")), season_window: str(f, "season_window"), options_json: str(f, "options_json"),
  });
  back("/admin/cards", r);
}

export async function toggleCardAction(f: FormData): Promise<void> {
  await admin();
  back("/admin/cards", await setCardEnabled(str(f, "id"), str(f, "enabled") === "1"));
}

export async function removeOverrideAction(f: FormData): Promise<void> {
  await admin();
  const id = str(f, "id");
  back(`/admin/cards/${encodeURIComponent(id)}`, await removeOverride(id, str(f, "deck")));
}
