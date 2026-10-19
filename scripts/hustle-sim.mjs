// Does the side hustle behave the way spec §7 asks? Roughly break-even once the
// evening is priced in, high variance, able to lose money.
// Mirrors src/lib/hustle-data.ts - if those numbers change, change these.
// Run: node scripts/hustle-sim.mjs

const CRAFTS = {
  crochet: {
    batchCost: 1200,
    items: [
      { key: "scrunchie", evenings: 1, batches: 1, yields: 6, price: 300, appeal: 1.0 },
      { key: "headband", evenings: 1, batches: 1, yields: 4, price: 500, appeal: 0.8 },
      { key: "hat", evenings: 2, batches: 1, yields: 3, price: 1000, appeal: 0.6 },
      { key: "blanket", evenings: 3, batches: 2, yields: 1, price: 5000, appeal: 0.25 },
    ],
  },
  art: {
    batchCost: 1000,
    items: [
      { key: "prints", evenings: 1, batches: 1, yields: 5, price: 400, appeal: 1.0 },
      { key: "cards", evenings: 1, batches: 1, yields: 4, price: 500, appeal: 0.9 },
      { key: "framed", evenings: 2, batches: 1, yields: 2, price: 1600, appeal: 0.5 },
      { key: "commission", evenings: 3, batches: 2, yields: 1, price: 3500, appeal: 0.25 },
    ],
  },
  jewellery: {
    batchCost: 1000,
    items: [
      { key: "earrings", evenings: 1, batches: 1, yields: 6, price: 400, appeal: 1.0 },
      { key: "bracelets", evenings: 1, batches: 1, yields: 4, price: 600, appeal: 0.8 },
      { key: "necklaces", evenings: 2, batches: 1, yields: 3, price: 1000, appeal: 0.6 },
      { key: "set", evenings: 3, batches: 2, yields: 1, price: 3500, appeal: 0.25 },
    ],
  },
  baking: {
    batchCost: 800,
    items: [
      { key: "cookies", evenings: 1, batches: 1, yields: 5, price: 300, appeal: 1.0 },
      { key: "cupcakes", evenings: 1, batches: 1, yields: 2, price: 700, appeal: 0.9 },
      { key: "cake", evenings: 2, batches: 1, yields: 1, price: 2500, appeal: 0.5 },
      { key: "tiered", evenings: 3, batches: 2, yields: 1, price: 4500, appeal: 0.2 },
    ],
  },
};
const BANDS = [[15, 0], [30, 0.5], [35, 1.0], [20, 1.6]];
const SEASONAL = { 1: 0.6, 2: 0.4, 3: 0.8, 4: 0.9, 5: 1, 6: 1, 7: 0.9, 8: 0.8, 9: 1, 10: 1, 11: 1.3, 12: 1.7 };
const BASE_CAPACITY = 6;
const WEEKS = 12;
const RUNS = 20000;

function makeRand(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

function pickWeighted(items, r) {
  const total = items.reduce((n, i) => n + i.weight, 0);
  let t = r * total;
  for (const i of items) { t -= i.weight; if (t <= 0) return i; }
  return items[items.length - 1];
}

/** evenings: making evenings per week. strategy: which item the player makes. */
function season(craft, startMonth, evenings, strategy, rand) {
  let spent = 0, revenue = 0;
  const stock = {};
  craft.items.forEach((i) => (stock[i.key] = 0));
  let pool = 0; // making evenings carry over, as they do in the game
  let current = null, done = 0;
  const menu = craft.items.map((i) => ({ key: i.key, weight: i.appeal }));

  for (let w = 0; w < WEEKS; w++) {
    const month = ((startMonth - 1 + Math.floor((w * 7) / 30)) % 12) + 1;
    pool += evenings;
    while (pool > 0) {
      if (!current) { current = strategy(craft.items, rand); done = 0; spent += current.batches * craft.batchCost; }
      pool--; done++;
      if (done === current.evenings) { stock[current.key] += current.yields; current = null; }
    }
    const band = pickWeighted(BANDS.map(([weight, factor]) => ({ weight, factor })), rand());
    const buyers = Math.round(BASE_CAPACITY * SEASONAL[month] * band.factor);
    for (let n = 0; n < buyers; n++) {
      const wanted = pickWeighted(menu, rand());
      if (stock[wanted.key] > 0) {
        stock[wanted.key]--;
        revenue += craft.items.find((i) => i.key === wanted.key).price;
      }
    }
  }
  return { profit: revenue - spent, spent };
}

const STRATEGIES = {
  "the cheap one only": (items) => items[0],
  "any item at random": (items, r) => items[Math.floor(r() * items.length)],
  "what sells (by appeal)": (items, r) => pickWeighted(items.map((i) => ({ ...i, weight: i.appeal })), r()),
  "the big one only": (items) => items[items.length - 1],
};

const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
const f = (n) => `£${(n / 100).toFixed(0)}`.padStart(7);

for (const [name, craft] of Object.entries(CRAFTS)) {
  for (const [startMonth, label] of [[10, "Oct-Dec (autumn, Christmas)"], [1, "Jan-Mar (dead of winter)"]]) {
    console.log(`\n${name}, season starting ${label}`);
    console.log("  evenings/wk  strategy             median    10th    90th   lost money   profit per evening");
    for (const evenings of [1, 2, 3]) {
      for (const [sname, strat] of Object.entries(STRATEGIES)) {
        const out = [];
        for (let i = 0; i < RUNS; i++) out.push(season(craft, startMonth, evenings, strat, makeRand(7919 + i * 2654435761)).profit);
        out.sort((a, b) => a - b);
        const lost = out.filter((p) => p < 0).length / RUNS;
        console.log(
          `  ${String(evenings).padEnd(12)} ${sname.padEnd(20)} ${f(pct(out, 0.5))}${f(pct(out, 0.1))}${f(pct(out, 0.9))}` +
          `   ${(lost * 100).toFixed(0).padStart(5)}%      ${f(pct(out, 0.5) / (evenings * WEEKS))}`,
        );
      }
    }
  }
}
console.log("\nA £22 shift is worth £22 an evening. Anything under that is the price of the hustle.");
