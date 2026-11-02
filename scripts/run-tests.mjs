// Runs every test script against its own throwaway PGlite. Run: npm test
// rollover-test.ts reuses the database hustle-test.ts leaves behind, so the two share a folder.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const groups = [
  ["goals-test.ts"],
  ["hustle-test.ts", "rollover-test.ts"],
  ["asks-test.ts"],
  ["fundraisers-test.ts"],
  ["phase4-test.ts"],
];

const failed = [];
for (const group of groups) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moneytrials-test-"));
  for (const script of group) {
    console.log(`\n--- ${script}`);
    const run = spawnSync("npx", ["tsx", "--conditions=react-server", path.join("scripts", script)], {
      stdio: "inherit",
      shell: true,
      env: { ...process.env, PGLITE_DIR: dir },
    });
    if (run.status !== 0) failed.push(script);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed.length ? `\nFailed: ${failed.join(", ")}` : "\nAll test scripts passed.");
process.exit(failed.length ? 1 : 0);
