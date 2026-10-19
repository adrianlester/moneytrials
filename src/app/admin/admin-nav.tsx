import Link from "next/link";
import { logoutAction } from "../actions";

export function AdminNav({ on }: { on: "overview" | "cards" | "ledger" | "report" }) {
  return (
    <>
      <form action={logoutAction} style={{ marginTop: 24 }}>
        <button type="submit">Log out</button>
      </form>
      <nav className="bottom">
        <Link href="/admin" className={on === "overview" ? "on" : ""}>Overview</Link>
        <Link href="/admin/cards" className={on === "cards" ? "on" : ""}>Cards</Link>
        <Link href="/admin/ledger" className={on === "ledger" ? "on" : ""}>Ledgers</Link>
        <Link href="/admin/report" className={on === "report" ? "on" : ""}>Report</Link>
      </nav>
    </>
  );
}
