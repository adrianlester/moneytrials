import Link from "next/link";
import { Nav } from "../../nav";

export const dynamic = "force-dynamic";

export default async function PaydayDone({
  searchParams,
}: {
  searchParams: Promise<{ n?: string }>;
}) {
  const { n } = await searchParams;
  let notes: string[] = [];
  try {
    notes = n ? (JSON.parse(n) as string[]) : [];
  } catch {
    notes = [];
  }

  return (
    <main>
      <h1>Week started</h1>
      <p className="sub">Every pound has a job.</p>

      {notes.map((note, i) => (
        <div className="note" key={i}>{note}</div>
      ))}

      <Link href="/" className="btn primary">See today</Link>
      <Nav on="payday" />
    </main>
  );
}
