import { redirect } from "next/navigation";
import Link from "next/link";
import { currentPlayer } from "@/lib/auth";
import { listCards } from "@/lib/admin";
import { createCardAction, toggleCardAction } from "../../admin-actions";
import { AdminNav } from "../admin-nav";

export const dynamic = "force-dynamic";

const NEW_OPTIONS = `[
  { "id": "a", "label": "Pay £5", "spend": { "enjoyment": 500 } },
  { "id": "b", "label": "Skip it" }
]`;

export default async function Cards({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; e?: string; q?: string }>;
}) {
  const { m, e, q } = await searchParams;
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/");

  const all = await listCards();
  const needle = (q ?? "").trim().toLowerCase();
  const cards = needle ? all.filter((c) => c.title.toLowerCase().includes(needle) || c.id.includes(needle)) : all;
  const off = all.filter((c) => !c.enabled).length;

  return (
    <main>
      <h1>Cards</h1>
      <p className="sub">{all.length} in the deck{off ? `, ${off} switched off` : ""}.</p>
      {m && <div className="note">{m}</div>}
      {e && <div className="note err">{e}</div>}

      <form className="card" method="get">
        <div className="field">
          <label htmlFor="q">Find a card</label>
          <input id="q" name="q" defaultValue={q ?? ""} autoComplete="off" />
        </div>
        <button type="submit">Search</button>
      </form>

      <div className="card">
        {cards.slice(0, 120).map((c) => (
          <div className="row" key={c.id}>
            <span className="label">
              <Link href={`/admin/cards/${encodeURIComponent(c.id)}`}>{c.title}</Link>
              <span className="blurb">
                {c.kind}{c.window ? `, ${c.window}` : ""}{c.overridden.length ? `, changed in ${c.overridden.join(", ")}` : ""}
              </span>
            </span>
            <form action={toggleCardAction}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
              <button type="submit" style={{ width: "auto", margin: 0, padding: "6px 12px" }}>{c.enabled ? "On" : "Off"}</button>
            </form>
          </div>
        ))}
        {cards.length > 120 && <p className="sub">Showing 120. Search to narrow it.</p>}
      </div>

      <details className="card">
        <summary>Write a new card</summary>
        <form action={createCardAction} style={{ marginTop: 12 }}>
          <div className="field"><label htmlFor="n_id">Short id</label><input id="n_id" name="id" placeholder="fixed-bike" autoComplete="off" /></div>
          <div className="field">
            <label htmlFor="n_kind">Kind</label>
            <select id="n_kind" name="kind" defaultValue="dilemma"><option value="dilemma">Dilemma (a real choice)</option><option value="event">Event</option></select>
          </div>
          <div className="field"><label htmlFor="n_title">Title</label><input id="n_title" name="title" autoComplete="off" /></div>
          <div className="field"><label htmlFor="n_body">Text</label><textarea id="n_body" name="body" rows={3} /></div>
          <div className="field"><label htmlFor="n_weight">Weight (1 to 10, how often)</label><input id="n_weight" name="weight" defaultValue="1" inputMode="numeric" /></div>
          <div className="field"><label htmlFor="n_win">Only dealt between (optional, like 12-01..12-24)</label><input id="n_win" name="season_window" autoComplete="off" /></div>
          <div className="field">
            <label htmlFor="n_opts">Options (JSON, amounts in pence)</label>
            <textarea id="n_opts" name="options_json" rows={8} defaultValue={NEW_OPTIONS} style={{ fontFamily: "monospace" }} />
          </div>
          <button type="submit" className="primary">Add the card</button>
        </form>
      </details>

      <AdminNav on="cards" />
    </main>
  );
}
