/**
 * The time economy — spec §6.
 *
 * Five evenings a week, allocated on payday alongside the money. The rules live
 * here as data for the same reason the envelope rules do: there is one place to
 * get them wrong, and the UI, the engine and the simulator all read it.
 *
 * The design note this was built from is the designer's, 18 Sep:
 *
 *   "time is actually their more precious asset ... unless it's buy something to
 *    save time (or save the money and take the time)"
 *
 * That is the card shape with the most teeth in the game, because it is the only
 * one where the cheap option costs something the player can feel. It needs an
 * evening to be a real, scarce, already-committed thing before it can take one
 * away — which is what this module makes true.
 */

export type EveningKind = "shift" | "making" | "going_out" | "nothing";

export interface EveningRule {
  kind: EveningKind;
  label: string;
  blurb: string;
  /** Flat pay for an extra shift. Banked until payday — every pound gets a job. */
  earns: number;
  /** Going out costs an amount rolled per evening, inside this range. */
  costRange: [number, number] | null;
  /** Does this evening satisfy the Enjoyment depletion clock? */
  feedsEnjoyment: boolean;
  /** Does it produce side-hustle stock? (§7 consumes these.) */
  produces: boolean;
  order: number;
}

export const EVENINGS: Record<EveningKind, EveningRule> = {
  shift: {
    kind: "shift",
    label: "Extra shift",
    blurb: "£22, and the evening's gone. Two a week at most.",
    earns: 2200,
    costRange: null,
    feedsEnjoyment: false,
    produces: false,
    order: 1,
  },
  making: {
    kind: "making",
    label: "Making",
    blurb: "Turn supplies into stock. Costs nothing tonight.",
    earns: 0,
    costRange: null,
    feedsEnjoyment: false,
    produces: true,
    order: 2,
  },
  going_out: {
    kind: "going_out",
    label: "Going out",
    blurb: "Somewhere between £8 and £25. You won't know which until you go.",
    earns: 0,
    costRange: [800, 2500],
    feedsEnjoyment: true,
    produces: false,
    order: 3,
  },
  nothing: {
    kind: "nothing",
    label: "Nothing",
    blurb: "Costs nothing, earns nothing. Always allowed.",
    earns: 0,
    costRange: null,
    feedsEnjoyment: false,
    produces: false,
    order: 4,
  },
};

export const EVENING_KINDS = Object.values(EVENINGS)
  .sort((a, b) => a.order - b.order)
  .map((e) => e.kind);

/** Spec §6: five evenings per week. */
export const EVENINGS_PER_WEEK = 5;

/**
 * At most two extra shifts a week — the designer, 6 Oct. Uncapped, five shifts at £22
 * out-earned the £95 wage and "work every evening" was the optimal strategy.
 * £22 is left as the spec has it; the cap is what stops it dominating.
 */
export const MAX_SHIFTS_PER_WEEK = 2;

export function isEveningKind(s: string): s is EveningKind {
  return s in EVENINGS;
}

/**
 * What going out costs on a given evening. Rolled from a seed so a refresh never
 * changes it, and so the day-rollover job can re-run without moving the number.
 * The player is shown the range when they plan and the figure when they go.
 */
export function rollGoingOutCost(rand: () => number): number {
  const [lo, hi] = EVENINGS.going_out.costRange!;
  // Round to 50p — an £8.37 night out reads like a spreadsheet, not an evening.
  return Math.round((lo + rand() * (hi - lo)) / 50) * 50;
}
