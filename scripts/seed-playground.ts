/**
 * Seeds the demo season (src/lib/demo.ts) into an empty local database, so today falls in week 4.
 * Test logins, throwaway data only:  Robin 1111 | Sam 2222 | Dad (admin) 3333
 *
 * Run (PGLITE_DIR must point at an empty folder):
 *   $env:PGLITE_DIR = "$env:TEMP\moneytrials-playground"
 *   npx tsx --conditions=react-server scripts/seed-playground.ts
 */
import { seedDemo } from "../src/lib/demo";

seedDemo()
  .then((s) => {
    console.log("ledger rows:", s.ledgerRows);
    console.log("cards answered:", s.cardsAnswered);
    console.log("asks answered:", s.asksAnswered);
    process.exit(0);
  })
  .catch((e) => { console.error(e); process.exit(1); });
