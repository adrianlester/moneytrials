import { redirect } from "next/navigation";
import Link from "next/link";
import { currentPlayer } from "@/lib/auth";
import { cardForEdit, decks } from "@/lib/admin";
import { removeOverrideAction, saveCardAction } from "../../../admin-actions";
import { AdminNav } from "../../admin-nav";

export const dynamic = "force-dynamic";

export default async function EditCard({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deck?: string; m?: string; e?: string }>;
}) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const { deck = "standard", m, e } = await searchParams;
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role !== "admin") redirect("/");

  const card = await cardForEdit(id, deck);
  if (!card) redirect("/admin/cards");
  const deckList = await decks();
  let pretty = card.options_json;
  try { pretty = JSON.stringify(JSON.parse(card.options_json), null, 2); } catch { /* shown as stored */ }

  return (
    <main>
      <h1>{card.title}</h1>
      <p className="sub"><Link href="/admin/cards">All cards</Link> · {id}</p>
      {m && <div className="note">{m}</div>}
      {e && <div className="note err">{e}</div>}

      <div className="card">
        <p className="sub" style={{ margin: 0 }}>Editing for</p>
        <p style={{ margin: "6px 0 10px" }}>
          {deckList.map((d) => (
            <Link key={d.id} href={`/admin/cards/${encodeURIComponent(id)}?deck=${d.id}`} style={{ marginRight: 12, fontWeight: d.id === deck ? 700 : 400 }}>
              {d.id}
            </Link>
          ))}
        </p>
        <p className="hint" style={{ margin: 0 }}>
          {deck === "standard"
            ? "The main deck. Every other deck copies this unless it has its own version."
            : card.isOverride
              ? `This card has its own version in ${deck}.`
              : `${deck} has no version of this card yet. Saving makes one.`}
        </p>
      </div>

      <form action={saveCardAction} className="card">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="deck" value={deck} />
        <div className="field">
          <label htmlFor="kind">Kind</label>
          <select id="kind" name="kind" defaultValue={card.kind}><option value="dilemma">Dilemma</option><option value="event">Event</option></select>
        </div>
        <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" defaultValue={card.title} autoComplete="off" /></div>
        <div className="field"><label htmlFor="body">Text</label><textarea id="body" name="body" rows={4} defaultValue={card.body} /></div>
        <div className="field"><label htmlFor="weight">Weight (1 to 10)</label><input id="weight" name="weight" defaultValue={String(card.weight)} inputMode="numeric" /></div>
        <div className="field"><label htmlFor="win">Only dealt between (optional)</label><input id="win" name="season_window" defaultValue={card.season_window ?? ""} autoComplete="off" /></div>
        <div className="field">
          <label htmlFor="opts">Options (JSON, amounts in pence)</label>
          <textarea id="opts" name="options_json" rows={14} defaultValue={pretty} style={{ fontFamily: "monospace", fontSize: 13 }} />
        </div>
        <button type="submit" className="primary">Save</button>
        <p className="hint" style={{ marginTop: 10 }}>
          Players are never shown which deck they are on. Keep option ids the same across decks.
        </p>
      </form>

      {card.isOverride && (
        <form action={removeOverrideAction} className="card">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="deck" value={deck} />
          <button type="submit">Remove the {deck} version</button>
        </form>
      )}

      <AdminNav on="cards" />
    </main>
  );
}
