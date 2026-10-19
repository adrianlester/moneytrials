/**
 * Season balance simulator.
 *
 * Answers one question the deck cannot be grown without: how much money does a
 * player actually have left for Goals across a 12-week season? A goal priced
 * above that is decoration; one priced well below it teaches nothing.
 *
 * It models the real rules — the wage bands in engine.ts, committed giving
 * leaving first, one card a day dealt without repeats — and plays them under
 * three policies so the answer comes as a range, not a single number.
 *
 *   node scripts/season-sim.mjs [--weeks 12] [--wage 95] [--giving 3] [--runs 20000]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const deck = JSON.parse(readFileSync(join(here, "../src/content/deck.json"), "utf8"));
const CARDS = Array.isArray(deck) ? deck : deck.cards ?? [];

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};

const WEEKS  = arg("weeks", 12);
const WAGE   = arg("wage", 95) * 100;
const GIVING = arg("giving", 3) * 100;
const RUNS   = arg("runs", 20000);

// Mirrors BANDS in src/lib/engine.ts. Kept in step by hand; if the engine
// changes, change it here too — a simulator that lies is worse than none.
const BANDS = [
  { band: "base",    weight: 60, factor: 1.0  },
  { band: "reduced", weight: 20, factor: 0.63 },
  { band: "boosted", weight: 15, factor: 1.37 },
  { band: "zero",    weight: 5,  factor: 0    },
];
const BAND_TOTAL = BANDS.reduce((n, b) => n + b.weight, 0);

function rollWage(rand) {
  let t = rand() * BAND_TOTAL;
  for (const b of BANDS) {
    t -= b.weight;
    if (t <= 0) return Math.round((WAGE * b.factor) / 500) * 500;
  }
  return WAGE;
}

/** Net cost of taking an option: what leaves, minus what arrives. */
function netCost(o) {
  const spend = o.spend ? Object.values(o.spend).reduce((a, b) => a + b, 0) : 0;
  return spend + (o.obligation ?? 0) - (o.income ?? 0);
}

const POLICIES = {
  frugal: (opts) => opts.reduce((a, b) => (netCost(b) < netCost(a) ? b : a)),
  spendy: (opts) => opts.reduce((a, b) => (netCost(b) > netCost(a) ? b : a)),
  mixed:  (opts, rand) => opts[Math.floor(rand() * opts.length)],
};

function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Spec §6, mirrored from src/lib/evenings.ts.
const EVENINGS_PER_WEEK = 5;
const SHIFT_PAY = 2200;
const MAX_SHIFTS_PER_WEEK = 2;
const OUT_RANGE = [800, 2500];

/**
 * How the five evenings get spent. This matters more than it looks: five extra
 * shifts is £110 a week against a £95 wage, so the time economy can more than
 * double income if nothing pulls the other way.
 */
const EVENING_POLICIES = {
  grind: () => "shift",
  social: (rand) => (rand() < 0.6 ? "going_out" : "nothing"),
  balanced: (rand) => {
    const r = rand();
    return r < 0.4 ? "shift" : r < 0.65 ? "making" : r < 0.85 ? "going_out" : "nothing";
  },
  idle: () => "nothing",
};

/** One season. Returns pence available for Goals, and whether they went broke. */
function playSeason(policy, eveningPolicy, rand) {
  let purse = 0;          // everything not yet committed to giving
  let worstPoint = 0;     // most negative the purse ever went = broke
  let bag = [];
  let eveningsLeft = 0;

  for (let w = 0; w < WEEKS; w++) {
    purse += rollWage(rand);
    purse -= GIVING;      // committed giving leaves first, always

    eveningsLeft = EVENINGS_PER_WEEK;
    let shiftsThisWeek = 0;
    for (let e = 0; e < EVENINGS_PER_WEEK; e++) {
      let kind = EVENING_POLICIES[eveningPolicy](rand);
      // The cap: a player who wants a third shift gets an idle evening instead.
      if (kind === "shift" && shiftsThisWeek >= MAX_SHIFTS_PER_WEEK) kind = "nothing";
      if (kind === "shift") { shiftsThisWeek++; purse += SHIFT_PAY; }
      else if (kind === "going_out") {
        purse -= Math.round((OUT_RANGE[0] + rand() * (OUT_RANGE[1] - OUT_RANGE[0])) / 50) * 50;
      }
      // Making costs nothing tonight; its supplies and returns are §7's job.
    }

    for (let d = 0; d < 7; d++) {
      if (bag.length === 0) bag = shuffled(CARDS, rand);
      const card = bag.pop();
      const opts = card.options ?? [];
      if (opts.length === 0) continue;
      const opt = POLICIES[policy](opts, rand);
      purse -= netCost(opt);
      // An evening taken is an evening that cannot also have been worked. The
      // cheap option is usually the one that carries it, which is the point.
      if (opt.takesEvening && eveningsLeft > 0) eveningsLeft--;
      if (purse < worstPoint) worstPoint = purse;
    }
  }
  return { goals: purse, broke: worstPoint < 0 };
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

console.log(
  `The Season — ${WEEKS} weeks · base wage £${WAGE / 100} · committed giving £${GIVING / 100}/wk · ` +
  `${CARDS.length} cards · ${RUNS.toLocaleString()} runs\n`,
);

const expectedWage =
  BANDS.reduce((n, b) => n + b.weight * Math.round((WAGE * b.factor) / 500) * 500, 0) / BAND_TOTAL;
console.log(
  `Expected income: £${(expectedWage / 100).toFixed(2)}/week → ` +
  `£${((expectedWage * WEEKS) / 100).toFixed(2)} over the season`,
);
console.log(`Committed giving takes £${(GIVING * WEEKS) / 100} of that.\n`);

function run(policy, eveningPolicy) {
  const out = [];
  let broke = 0;
  for (let i = 0; i < RUNS; i++) {
    let x = 123456789 + i * 2654435761;
    const rand = () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >> 17;
      x ^= x << 5;  x >>>= 0;
      return x / 4294967296;
    };
    const r = playSeason(policy, eveningPolicy, rand);
    out.push(r.goals);
    if (r.broke) broke++;
  }
  out.sort((a, b) => a - b);
  out.broke = broke / RUNS;
  return out;
}

const f = (n) => `£${(n / 100).toFixed(0)}`.padStart(8);

console.log("Money left for Goals after a full season, by how the cards are played");
console.log("(evenings held at 'balanced' — some shifts, some making, some going out)\n");
console.log("  policy    median    10th pct   90th pct   went broke");
console.log("  ------------------------------------------------------");

const results = {};
for (const policy of ["frugal", "mixed", "spendy"]) {
  const out = run(policy, "balanced");
  results[policy] = out;
  console.log(
    `  ${policy.padEnd(9)}${f(pct(out, 0.5))}${f(pct(out, 0.1))}${f(pct(out, 0.9))}` +
    `${(out.broke * 100).toFixed(1).padStart(12)}%`,
  );
}

console.log("\nWhat the FIVE EVENINGS are worth, holding the cards at mixed:\n");
console.log("  evenings  median    10th pct   90th pct   went broke");
console.log("  ------------------------------------------------------");
for (const ep of ["grind", "balanced", "social", "idle"]) {
  const out = run("mixed", ep);
  console.log(
    `  ${ep.padEnd(9)}${f(pct(out, 0.5))}${f(pct(out, 0.1))}${f(pct(out, 0.9))}` +
    `${(out.broke * 100).toFixed(1).padStart(12)}%`,
  );
}
const grind = run("mixed", "grind");
const idle = run("mixed", "idle");
console.log(
  `\n  Working every evening rather than none is worth ` +
  `£${((pct(grind, 0.5) - pct(idle, 0.5)) / 100).toFixed(0)} across the season, ` +
  `against a base wage of £${(WAGE * WEEKS) / 100}. The time economy is not a garnish.`,
);

const mixed = results.mixed;
console.log(`
What that means for goal pricing
--------------------------------
A goal is only a decision if holding the line is what buys it. Against the
MIXED player — the one who is neither disciplined nor reckless:

  reachable without trying   under £${(pct(mixed, 0.1) / 100).toFixed(0)}   (the unlucky tenth still get there)
  a real line to hold        £${(pct(mixed, 0.1) / 100).toFixed(0)}–£${(pct(mixed, 0.9) / 100).toFixed(0)}
  decoration                 over £${(pct(mixed, 0.9) / 100).toFixed(0)}   (nine seasons in ten fall short)

Note both girls also carry Bills and Enjoyment out of the same purse, and
Enjoyment cannot sit at zero for ten days without an impulse purchase firing.
The figures above are the ceiling, not the budget.`);
