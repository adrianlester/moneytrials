import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * One query interface, two backends, identical SQL.
 *
 * DATABASE_URL set  -> postgres.js against Neon/Supabase (what Vercel will use).
 * DATABASE_URL unset -> PGlite, real Postgres compiled to WASM, persisted in .data/.
 *
 * The point is that the SQL never changes. Provisioning Neon later is a
 * connection string, not a rewrite.
 */

export type Row = Record<string, unknown>;

interface Backend {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

let backendPromise: Promise<Backend> | null = null;

async function makeBackend(): Promise<Backend> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { max: 4 });
    return {
      async query<T>(text: string, params: unknown[] = []) {
        return (await sql.unsafe(text, params as never[])) as unknown as T[];
      },
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  // PGLITE_DIR gives a throwaway season without disturbing the real .data/ —
  // needed to test a payday flow end to end when the live season has already
  // had its wage allocated for the week.
  const dir = process.env.PGLITE_DIR
    ? path.resolve(process.env.PGLITE_DIR)
    : path.join(process.cwd(), ".data", "season");
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const pg = new PGlite(dir);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await pg.query<T>(text, params as never[]);
      return res.rows;
    },
  };
}

async function backend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = makeBackend().then(async (b) => {
      await applySchema(b);
      return b;
    });
  }
  return backendPromise;
}

async function applySchema(b: Backend): Promise<void> {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "src", "lib", "schema.sql"),
    "utf8",
  );
  // Statement-at-a-time: PGlite's simple protocol will not take a batch.
  // Normalised first: an editor that saves CRLF would otherwise turn the whole
  // schema into one statement, which PGlite rejects.
  for (const stmt of schema.replace(/\r\n/g, "\n").split(";\n").map((s) => s.trim()).filter(Boolean)) {
    await b.query(stmt);
  }
}

/** Drops every table and recreates the schema empty. Only the demo's nightly reset calls this. */
export async function resetSchema(): Promise<void> {
  const b = await backend();
  const tables = await b.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (tables.length) {
    await b.query(`DROP TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }
  await applySchema(b);
}

export async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const b = await backend();
  return b.query<T>(sql, params);
}

export async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows[0] ?? null;
}
