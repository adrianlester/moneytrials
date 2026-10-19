/**
 * Envelope rules in one place.
 *
 * The spec calls the unraidable giving envelopes "the single most important rule
 * in the game" and says to enforce it absolutely, including against admin. So the
 * rule lives here as data and every mutation path asks this module rather than
 * re-deciding it. There is deliberately no override parameter.
 */

export type EnvelopeType =
  | "bills"
  | "goals"
  | "enjoyment"
  | "committed_giving"
  | "giving_reserve";

export interface EnvelopeRule {
  type: EnvelopeType;
  label: string;
  blurb: string;
  raidable: boolean;
  rollsOver: boolean;
  /** Shown in the payday allocator, in this order. */
  allocatable: boolean;
  order: number;
}

export const ENVELOPES: Record<EnvelopeType, EnvelopeRule> = {
  bills: {
    type: "bills",
    label: "Bills",
    blurb: "Phone, bus, subscriptions. Locked once assigned.",
    raidable: false,
    rollsOver: false,
    allocatable: true,
    order: 1,
  },
  goals: {
    type: "goals",
    label: "Goals",
    blurb: "The things you're saving for.",
    raidable: true,
    rollsOver: true,
    allocatable: true,
    order: 2,
  },
  enjoyment: {
    type: "enjoyment",
    label: "Enjoyment",
    blurb: "Going out, treats, whatever you like.",
    raidable: true,
    rollsOver: true,
    allocatable: true,
    order: 3,
  },
  giving_reserve: {
    type: "giving_reserve",
    label: "Giving Reserve",
    blurb: "Held back for asks that turn up mid-week. Can't be taken back out.",
    raidable: false,
    rollsOver: true,
    allocatable: true,
    order: 4,
  },
  committed_giving: {
    type: "committed_giving",
    label: "Committed Giving",
    blurb: "Leaves automatically every payday.",
    raidable: false,
    rollsOver: false,
    allocatable: false,
    order: 5,
  },
};

export const ALL_TYPES = Object.values(ENVELOPES)
  .sort((a, b) => a.order - b.order)
  .map((e) => e.type);

export const ALLOCATABLE_TYPES = Object.values(ENVELOPES)
  .filter((e) => e.allocatable)
  .sort((a, b) => a.order - b.order)
  .map((e) => e.type);

export function canRaid(type: EnvelopeType): boolean {
  return ENVELOPES[type].raidable;
}

/** Which envelopes a shortfall may be covered from, best-first. */
export function raidOrder(): EnvelopeType[] {
  return ["enjoyment", "goals"];
}
