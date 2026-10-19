import Link from "next/link";

export function Nav({ on }: { on: "home" | "payday" | "hustle" | "ledger" | "help" }) {
  return (
    <nav className="bottom">
      <Link href="/" className={on === "home" ? "on" : ""}>Today</Link>
      <Link href="/payday" className={on === "payday" ? "on" : ""}>Payday</Link>
      <Link href="/hustle" className={on === "hustle" ? "on" : ""}>Hustle</Link>
      <Link href="/ledger" className={on === "ledger" ? "on" : ""}>Ledger</Link>
      <Link href="/help" className={on === "help" ? "on" : ""}>Help</Link>
    </nav>
  );
}
