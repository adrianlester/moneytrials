import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { one } from "./db";

const COOKIE = "season_session";

function secret(): string {
  return process.env.SESSION_SECRET ?? "dev-only-secret-change-before-deploy";
}

export function hashPin(pin: string, salt?: string): string {
  const s = salt ?? crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pin, s, 32).toString("hex");
  return `${s}:${hash}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(pin, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

function sign(value: string): string {
  const mac = crypto.createHmac("sha256", secret()).update(value).digest("hex");
  return `${value}.${mac}`;
}

function unsign(signed: string): string | null {
  const i = signed.lastIndexOf(".");
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const mac = signed.slice(i + 1);
  const expected = crypto.createHmac("sha256", secret()).update(value).digest("hex");
  if (mac.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return value;
}

export interface SessionPlayer {
  id: string;
  display_name: string;
  role: "player" | "admin";
  season_id: string;
  setup_done: boolean;
  craft: string | null;
  base_wage: number;
  wage_variance: boolean;
  deck_id: string;
}

export async function startSession(playerId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign(playerId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 120, // a season and then some
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function currentPlayer(): Promise<SessionPlayer | null> {
  const jar = await cookies();
  const raw = jar.get(COOKIE)?.value;
  if (!raw) return null;
  const id = unsign(raw);
  if (!id) return null;
  return one<SessionPlayer>(
    `SELECT id, display_name, role, season_id, setup_done, craft, base_wage, wage_variance, deck_id
       FROM player WHERE id = $1`,
    [id],
  );
}
