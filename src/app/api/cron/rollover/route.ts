import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { rolloverAll } from "@/lib/rollover";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. With no secret
 * configured the route refuses everyone: an open endpoint that rewrites game state
 * is worse than a cron that does not run.
 */
function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(want);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const result = await rolloverAll();
  return NextResponse.json({ ok: true, ...result });
}
