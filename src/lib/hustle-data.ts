/**
 * The side hustle — spec §7. Rules as data, for the same reason the envelope and
 * evening rules are: one place to get them wrong, read by the engine, the UI and
 * the simulator.
 *
 * The spec's constraint is the one that shapes every number here: "This must be
 * able to lose money. Do not tune it to be reliably profitable." Target is roughly
 * break-even once the evening is priced in, with high variance. A player who
 * buys supplies and never makes anything, or makes the slow big item that nobody
 * asks for, should come out behind.
 */

export type Craft = "crochet" | "baking" | "art" | "jewellery";

export interface HustleItem {
  key: string;
  label: string;
  /** Making evenings needed to finish one run. */
  evenings: number;
  /** Batches of supplies a run uses, taken when the run starts. */
  batches: number;
  /** Items one run produces. */
  yields: number;
  /** List price per item, in pence. Fixed: there is no pricing decision in §7. */
  price: number;
  /**
   * Share of buyers who want this, against the rest of the menu. A £3 scrunchie
   * is an impulse buy; a baby blanket is somebody's gift and turns up rarely. A
   * buyer who wants something you haven't made walks away.
   */
  appeal: number;
  blurb: string;
}

export interface CraftRule {
  craft: Craft;
  label: string;
  supplyName: string;
  /** Cost of one batch of supplies, in pence. Spec §7. */
  batchCost: number;
  items: HustleItem[];
}

export const CRAFTS: Record<Craft, CraftRule> = {
  crochet: {
    craft: "crochet",
    label: "Crochet",
    supplyName: "yarn",
    batchCost: 1200,
    items: [
      { key: "scrunchie", label: "Scrunchies", evenings: 1, batches: 1, yields: 6, price: 300, appeal: 1.0, blurb: "Six from one evening. Cheap, and they go." },
      { key: "headband", label: "Ear-warmer headbands", evenings: 1, batches: 1, yields: 4, price: 500, appeal: 0.8, blurb: "Four from one evening." },
      { key: "hat", label: "Beanie hats", evenings: 2, batches: 1, yields: 3, price: 1000, appeal: 0.6, blurb: "Two evenings for three hats." },
      { key: "blanket", label: "Baby blanket", evenings: 3, batches: 2, yields: 1, price: 5000, appeal: 0.25, blurb: "Three evenings, two batches, one blanket. Someone has to want it." },
    ],
  },
  baking: {
    craft: "baking",
    label: "Baking",
    supplyName: "ingredients",
    batchCost: 800,
    items: [
      { key: "cookies", label: "Cookie bags", evenings: 1, batches: 1, yields: 5, price: 300, appeal: 1.0, blurb: "Five bags from one evening." },
      { key: "cupcakes", label: "Boxes of cupcakes", evenings: 1, batches: 1, yields: 2, price: 700, appeal: 0.9, blurb: "Two boxes of six, decorated." },
      { key: "cake", label: "Celebration cake", evenings: 2, batches: 1, yields: 1, price: 2500, appeal: 0.5, blurb: "Two evenings. Most of it is the decorating." },
      { key: "tiered", label: "Tiered cake", evenings: 3, batches: 2, yields: 1, price: 4500, appeal: 0.2, blurb: "Three evenings, two batches, one cake. Rarely asked for." },
    ],
  },
  art: {
    craft: "art",
    label: "Art prints",
    supplyName: "paper and ink",
    batchCost: 1000,
    items: [
      { key: "prints", label: "A5 prints", evenings: 1, batches: 1, yields: 5, price: 400, appeal: 1.0, blurb: "Five from one evening." },
      { key: "cards", label: "Packs of cards", evenings: 1, batches: 1, yields: 4, price: 500, appeal: 0.9, blurb: "Four packs of four." },
      { key: "framed", label: "Framed prints", evenings: 2, batches: 1, yields: 2, price: 1600, appeal: 0.5, blurb: "Two evenings, two frames." },
      { key: "commission", label: "Portrait commission", evenings: 3, batches: 2, yields: 1, price: 3500, appeal: 0.25, blurb: "Three evenings for one person who asked. Rarely asked for." },
    ],
  },
  jewellery: {
    craft: "jewellery",
    label: "Jewellery",
    supplyName: "beads and wire",
    batchCost: 1000,
    items: [
      { key: "earrings", label: "Pairs of earrings", evenings: 1, batches: 1, yields: 6, price: 400, appeal: 1.0, blurb: "Six pairs from one evening." },
      { key: "bracelets", label: "Bracelets", evenings: 1, batches: 1, yields: 4, price: 600, appeal: 0.8, blurb: "Four from one evening." },
      { key: "necklaces", label: "Necklaces", evenings: 2, batches: 1, yields: 3, price: 1000, appeal: 0.6, blurb: "Two evenings for three." },
      { key: "set", label: "Statement set", evenings: 3, batches: 2, yields: 1, price: 3500, appeal: 0.25, blurb: "Three evenings for one matching set. Rarely asked for." },
    ],
  },
};

export function craftRule(craft: string | null | undefined): CraftRule | null {
  return craft && craft in CRAFTS ? CRAFTS[craft as Craft] : null;
}

export function itemOf(craft: CraftRule, key: string): HustleItem | undefined {
  return craft.items.find((i) => i.key === key);
}

/* ------------------------------------------------------------------- market */

/** Buyers at an ordinary market, before the season and the day's luck scale it. */
export const BASE_CAPACITY = 6;

/**
 * A market day's luck. Shared by both players on the same date — it is the same
 * town on the same Saturday — and rolled from a seed so a refresh never changes it.
 */
export const DEMAND_BANDS = [
  { band: "dead",   weight: 15, factor: 0,   copy: "Nobody came. It rained." },
  { band: "quiet",  weight: 30, factor: 0.5, copy: "Quiet. A few people had a look." },
  { band: "fair",   weight: 35, factor: 1.0, copy: "A fair day." },
  { band: "busy",   weight: 20, factor: 1.6, copy: "Busy. The tables were three deep." },
] as const;

export type DemandBand = (typeof DEMAND_BANDS)[number]["band"];

/** By calendar month, 1..12. Christmas markets and school fairs are strong; February is dead. */
export const SEASONAL: Record<number, number> = {
  1: 0.6, 2: 0.4, 3: 0.8, 4: 0.9, 5: 1.0, 6: 1.0,
  7: 0.9, 8: 0.8, 9: 1.0, 10: 1.0, 11: 1.3, 12: 1.7,
};

export function seasonalFactor(day: string): number {
  return SEASONAL[Number(day.slice(5, 7))] ?? 1;
}

export function marketCapacity(day: string, bandFactor: number): number {
  return Math.round(BASE_CAPACITY * seasonalFactor(day) * bandFactor);
}
