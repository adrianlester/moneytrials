# The Money Trials

A 12-week budgeting game for teenagers. Each player runs their own economy as a 16-year-old with a Saturday job. Once a week they decide where every pound goes. Every other day they answer one short money question, such as an overtime shift against a friend's party. A parent plays the world: sets wages, writes cards and approves changes.

The game reports outcomes. It never scores giving and never lectures.

**Try it:** [moneytrials.co.uk](https://moneytrials.co.uk) is a demo with made-up players, three weeks into a season. The logins are on the page, and it resets every night.

## What this project shows

- **Spec first.** Written from a design spec, built in four phases. Phase 1 was playable end to end before anything else was added.
- **Tuned with simulation.** Bot players ran thousands of seasons through the real engine. That showed extra shifts out-earned the main job, so shifts are capped at two a week.
- **Tested.** Each feature has a test script that runs against the real engine and a local Postgres. `npm test` runs them all.
- **Shipped.** Next.js and TypeScript on Vercel, Postgres on Neon, a daily cron for the day rollover. It runs locally on PGlite with no setup.
- **Built with Claude Code.** I set the brief, made the design calls and tested it as a user. Claude Code wrote the code.

The names, places and birthday cards in this copy are placeholders. Swap in your own.


## Run it

```
npm run dev
```

http://localhost:3000. First run lands on `/setup`.

No database to provision. With `DATABASE_URL` unset the app runs **PGlite** — real
Postgres compiled to WASM, persisted in `.data/`. Set `DATABASE_URL` to a Neon or
Supabase connection string and the identical SQL runs there instead. That swap is the
only change needed for Vercel; see `src/lib/db.ts`.

Delete `.data/` to wipe and start a fresh season.

## Where the build is

**Phase 1 (playable core) — done and tested end to end.**

- Auth: name + 4-digit PIN, scrypt-hashed, HMAC-signed cookie. Three accounts.
- Season setup: weeks, payday weekday, ask frequency, three accounts in one form.
- Player setup: two or three named goals with real prices, Committed Giving amount + cause.
- Envelopes: all five, with the rules in `src/lib/envelopes.ts`.
- Payday: wage roll, committed giving leaving first, allocation with the
  all-pounds-assigned gate, leftover nibbled by an impulse purchase.
- Lumpy income: 60% base / 20% short / 15% boosted / 5% nothing, with next week's
  rota visible on payday and no further ahead.
- Daily cards: one per day, same card for both players, no repeats until the deck runs out.
- Raiding: Goals and Enjoyment only, in that order, with the shortfall reported.
- Obligations: unpaid ones fail the week.
- Goals with progress bars, filled from the Goals pot in creation order. A funded goal can
  be bought (price leaves the pot, goal moves to Bought); up to three can be open at once.
- Comparison view: what the other player chose on the same card.
- Enjoyment depletion: 10 days at zero triggers an impulse purchase, reported plainly.
- Weekly survival resolution and streaks.
- Ledger screen — the ledger is the source of truth; balances derive from it.

**Phase 2, first half (the time economy) — done and tested end to end, 21 Sep.**

- Five evenings a week, planned on payday in the same form as the money, with a
  gate of the same shape: all five or the week doesn't start.
- Extra shift £22, banked until payday so it still has to be given a job.
- Going out costs a rolled £8–£25. The player sees the RANGE when they plan and
  the figure when the evening arrives — committing time before knowing its price
  is the point, not an oversight.
- Making spends the evening and records it. Turning that into stock is §7's job
  and is the seam Phase 2's second half plugs into.
- Evenings resolve on the day they fall. Slot N is the Nth day of the game week.
- `takesEvening` on a card option consumes the soonest unspent evening and tells
  the player exactly what it cost them ("It took Tuesday evening — the extra
  shift. That's £22 you won't see.").

**Phase 2, second half (the side hustle, spec §7) — built and tested 6 Oct.**

- `/hustle` screen. Buy supplies (£12 a batch of yarn, £8 baking, paid from Goals then
  Enjoyment), spend Making evenings turning them into stock, sell on market day.
- Rules as data in `src/lib/hustle-data.ts`: four items per craft with evenings, batches,
  yield, price and appeal. Engine in `src/lib/hustle.ts`.
- One project at a time. A multi-evening item takes its supplies when started and is
  continued by each later Making evening; a card taking an evening leaves it where it was.
- Market day is weekly, on the season's payday weekday. Resolves on arrival, seeded, so
  a refresh never changes it. Demand is rolled from the DAY (both players share it) and
  scaled by month (Dec 1.7, Feb 0.4). Each buyer wants one item from the whole menu by
  appeal; a buyer who wants something you did not make walks away. Stock made after a
  market day cannot sell at it.
- Each sale's money is placed one sale at a time AFTER the amount is known: Mine (banked
  until payday, like a shift) or Giving Reserve. Nothing is pre-selected and the button
  stays disabled until every sale is decided.
- Cards can now carry `grantsSupplies` on an option. `supplies-run-low` and
  `bulk-or-single` use it.
- `npx tsx --conditions=react-server scripts/hustle-test.ts` runs the engine against a
  throwaway PGlite (`PGLITE_DIR` must be set). `node scripts/hustle-sim.mjs` is the economics.

- Crafts: crochet, baking, art prints, jewellery. Cards can book an extra market with
  `extraMarket: { daysAhead, boost }` on an option (table `extra_market`).

**Phase 3, asks (12 Oct) — built and tested.** `src/lib/asks.ts`, data in `asks-data.ts`, tables
`ask` and `ask_response`. Paid from the Giving Reserve only; declining is a recorded answer with no
penalty. `npx tsx --conditions=react-server scripts/asks-test.ts` (needs `PGLITE_DIR`).

**Phase 3, fundraisers (12 Oct) — built and tested.** `startFundraiser` in `asks.ts`; a fundraiser
reaches the other player as an ask. `scripts/fundraisers-test.ts`. `/help` is the how-to-play page.

**Phase 4 (12 Oct) — built and tested.** `admin.ts`, `commitments.ts`, `report.ts`; pages under `app/admin`, `app/account`, `app/report`. `scripts/phase4-test.ts`. Difficulty decks are overrides stored as `<card id>@<deck>`; `cardForPlayer()` in `engine.ts` is the one place a card is shown to a player.

**Not built yet:** nothing in the spec. Out of scope for v1 per the spec: investing, interest, credit cards, BNPL, notifications.

## Balance

`node scripts/season-sim.mjs` plays 20,000 seasons against the real rules and
reports what is left for Goals. Run it before pricing a goal or adding a wage
lever — it mirrors `BANDS` in `engine.ts` and the constants in `evenings.ts`, so
if those change, change the sim too.

Options: `--weeks 12 --wage 95 --giving 3 --runs 20000`.

**What it says as of 21 Sep, and it is the session's main finding: the time
economy dominates the money economy.** Working all five evenings rather than
none is worth £1,320 across a season whose base wage totals £1,140. Going out
most evenings goes broke 88% of the time. £22 an evening against a £95 week is
the lever doing that — five shifts out-earn the job. Left as found rather than
tuned: £22 is the spec's own number (§6) and the spec is the authority.

`node scripts/repoint-test-card.mjs <pglite-dir> <card-id>` forces today's dealt
card to a chosen one, for testing a specific card without waiting for it to come
up. Throwaway databases only — it rewrites today's `event_inst` row.

`PGLITE_DIR=/some/path npm run dev` runs against a disposable season, which is
how the above gets tested without disturbing `.data/`.

## The deck

`src/content/deck.json` — **90 cards, the ~90 a 12-week season needs (reached 6 Oct).** Card-writing
rules are in Appendix A of the spec. Cards are seeded on season creation and upserted
by id, so editing the JSON and creating a new season picks up changes.

Run `npm run deck:check` after editing. It validates option ids across variants, the
window format, and that no card has `takesEvening` on *every* option (that is a
tax, not a trade-off); it reports the dilemma share, how many cards cost an
evening, and how many are still missing.

### Cards that cost an evening

Six cards carry `takesEvening` on one option — the designer's shape from 18 Sep: *buy
the thing that saves the evening, or save the money and spend the evening*. They
are the only cards where the CHEAP option is the expensive one, which is why they
carry the most weight in the deck. `bus-both-ways`, `pre-cut-or-make` (with
crochet and baking variants), `express-postage`, `lift-or-late-bus`,
`fix-or-replace`, `batch-or-buy-daily`. A bakery-lunch card and a music-subscription card were added at the same time.

**The game's economy deliberately sits above the players' real one.** The players do not
have jobs, so the game gives them one: with no income there is nothing to budget, and
budgeting is the lesson. Ground every card in the players' real world, but do not pull the
amounts down to what they could reach today.

Card settings are placeholders: a town called Millbrook, a school bus to Eastport, a wool
shop on High Street, a roller rink and an ice rink. Swap in your own.

### Birthday cards

Cards can carry a `season_window` of `"MM-DD..MM-DD"` and are only dealt inside it
(`inWindow()` in `src/lib/engine.ts`). Windows wrap the year end. The real family
birthday cards were removed from this public copy; add your own.

### Card variants

Both players get the **same card on the same day** — the comparison view depends on it —
but the detail that makes a card land is personal. A card may carry `variants`, keyed on
the craft chosen at season start (`crochet` = Robin, `baking` = Sam), overriding title,
body and options. Same id, same day, same beat, different words. A craft with no variant
falls back to the generic text.

Two rules when writing them:

- **Keep the option ids identical across every variant and the base card.** The
  comparison view looks choices up by id. `npm run deck:check` enforces this.
- **Write the base card generically anyway.** It is what a third craft gets.

The comparison view renders the other player's choice from *their* variant, so Sam's
answer reads in Sam's words, not Robin's.

`npx tsx --conditions=react-server scripts/play-season.ts --reps 2` plays whole seasons through
the real engine with bot players (careful, mixed, spendy) and prints goals reached, failed weeks
and hustle profit. Needs `PGLITE_DIR` set. Takes a few minutes.

## Decisions taken

**Unallocated money — settled 18 Sep.** The gate is strict: payday refuses unless the
assigned total equals the available total exactly. The softer reading (nibble a £2–£8
impulse buy, bank the rest in Enjoyment) made ignoring principle 1 cost about a tenth
of what was ignored — £47 unassigned cost £5. The impulse-purchase mechanic still
exists where the spec's other rule needs it: ten days of Enjoyment at zero.

Because the gate refuses rather than absorbs, the allocator shows a live "still to
assign" figure and keeps the button disabled until it reads zero
(`src/app/payday/allocator.tsx`).

## Day rollover

`GET /api/cron/rollover`, scheduled in `vercel.json` at `0 5 * * *` UTC (06:00 in summer,
05:00 in winter, London). It does for every player what the home page does on arrival:
close finished weeks, resolve evenings and markets, run the Enjoyment clock, deal the day's
card. Safe to run twice and alongside a player opening the app. Anything the player would
have been told is stored in `notice` and shown once on their next visit.

It refuses every request unless `CRON_SECRET` is set; Vercel sends it as a Bearer token
once the variable exists in the project. Needs `DATABASE_URL` (Neon or Supabase) to be
useful on Vercel, since PGlite lives on local disk.
`npx tsx --conditions=react-server scripts/rollover-test.ts` checks it (run
`hustle-test.ts` first against the same `PGLITE_DIR` to seed a season).

The season is never marked `ended` by the job yet.

## Money

Stored as integer pence everywhere. `src/lib/money.ts` is the only place it becomes
a string.
