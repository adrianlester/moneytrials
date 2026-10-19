// Validates the deck before it reaches a season. Run: npm run deck:check
import fs from "node:fs";
import path from "node:path";

const file = path.join(process.cwd(), "src", "content", "deck.json");
const deck = JSON.parse(fs.readFileSync(file, "utf8"));
const problems = [];

const ids = new Set();
for (const c of deck.cards) {
  if (ids.has(c.id)) problems.push(`duplicate id: ${c.id}`);
  ids.add(c.id);

  if (!c.options?.length) problems.push(`${c.id}: no options`);
  if (c.kind === "dilemma" && c.options.length < 2) {
    problems.push(`${c.id}: a dilemma needs at least two options`);
  }

  if (c.season_window && !/^\d{2}-\d{2}\.\.\d{2}-\d{2}$/.test(c.season_window)) {
    problems.push(`${c.id}: season_window "${c.season_window}" is not MM-DD..MM-DD`);
  }

  const base = c.options.map((o) => o.id).join(",");
  for (const [craft, v] of Object.entries(c.variants ?? {})) {
    const got = (v.options ?? c.options).map((o) => o.id).join(",");
    if (got !== base) {
      // The comparison view looks choices up by id across players.
      problems.push(`${c.id} [${craft}]: option ids ${got} do not match base ${base}`);
    }
  }
}

// §6 cards: an option that costs an evening instead of money. A card where
// EVERY option takes an evening isn't a trade-off, it's a tax.
for (const c of deck.cards) {
  const takers = c.options.filter((o) => o.takesEvening).length;
  if (takers && takers === c.options.length) {
    problems.push(`${c.id}: every option takes an evening, so there is no choice in it`);
  }
}

const timeCards = deck.cards.filter((c) => c.options.some((o) => o.takesEvening)).length;
const windowed = deck.cards.filter((c) => c.season_window).length;
const dilemmas = deck.cards.filter((c) => c.kind === "dilemma").length;
const share = Math.round((dilemmas / deck.cards.length) * 100);

console.log(`${deck.cards.length} cards · ${deck.cards.filter((c) => c.variants).length} with variants · ${windowed} date-windowed · ${timeCards} cost an evening · ${share}% dilemmas (spec wants ~60%)`);
if (deck.cards.length < 90) {
  console.log(`note: ${90 - deck.cards.length} more needed for a full 12-week season`);
}

if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("deck ok");
