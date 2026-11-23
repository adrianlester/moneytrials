import Link from "next/link";
import { currentPlayer } from "@/lib/auth";
import { demoMode } from "@/lib/demo";

/** Demo only: a thin strip on every page saying who you are, with a way to switch. */
export async function DemoStrip() {
  if (!demoMode()) return null;
  let me: Awaited<ReturnType<typeof currentPlayer>> = null;
  try {
    me = await currentPlayer();
  } catch {
    // The nightly reset may be mid-way; the strip is not worth an error page.
  }
  if (!me) return null;
  const who = me.role === "admin" ? `the parent (${me.display_name})` : me.display_name;
  return (
    <div className="demo-strip">
      Demo · you&apos;re {who} · <Link href="/login">Switch player</Link>
    </div>
  );
}
