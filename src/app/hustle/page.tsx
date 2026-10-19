import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { gbp, gbpShort } from "@/lib/money";
import { londonToday, resolveEveningsUpTo, shortDay } from "@/lib/engine";
import { DEMAND_BANDS, itemOf, craftRule } from "@/lib/hustle-data";
import {
  availableMakingEvenings, nextMarketDay, openSalesFundraiser, pendingSales, projectOf, recentMarkets,
  resolveMarkets, stockCounts, suppliesOf,
} from "@/lib/hustle";
import { buySuppliesAction, decideSalesAction, makeAction } from "../actions";
import { Nav } from "../nav";
import { SalesForm } from "./sales-form";

export const dynamic = "force-dynamic";

export default async function Hustle({
  searchParams,
}: {
  searchParams: Promise<{ n?: string; e?: string }>;
}) {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");
  if (season.status !== "running") redirect("/");

  const { n, e } = await searchParams;
  const craft = craftRule(me.craft);

  if (!craft) {
    return (
      <main>
        <h1>Hustle</h1>
        <p className="sub">There is no craft set up for this account.</p>
        <Nav on="hustle" />
      </main>
    );
  }

  const day = londonToday();
  // Same arrival order as the home page: evenings first, then the market they feed.
  await resolveEveningsUpTo(me.id, day);
  const marketNotes = await resolveMarkets(me.id, craft, season.id, season.payday_weekday, day);

  const [supplies, stock, project, evenings, pending, markets, nextMarket] = await Promise.all([
    suppliesOf(me.id),
    stockCounts(me.id),
    projectOf(me.id),
    availableMakingEvenings(me.id),
    pendingSales(me.id),
    recentMarkets(me.id),
    nextMarketDay(season.id, season.payday_weekday, day, me.id),
  ]);

  const stockLines = craft.items.filter((i) => (stock[i.key] ?? 0) > 0);
  const stockTotal = stockLines.reduce((t, i) => t + (stock[i.key] ?? 0), 0);
  const stockValue = stockLines.reduce((t, i) => t + (stock[i.key] ?? 0) * i.price, 0);
  const projectItem = project ? itemOf(craft, project.item) : undefined;
  const bandCopy: Record<string, string> = Object.fromEntries(DEMAND_BANDS.map((b) => [b.band, b.copy]));
  const supplyTitle = craft.supplyName[0].toUpperCase() + craft.supplyName.slice(1);

  return (
    <main>
      <h1>{craft.label}</h1>
      <p className="sub">Buy {craft.supplyName}, spend evenings making, sell on market day.</p>

      {n && <div className="note">{n}</div>}
      {e && <div className="note err">{e}</div>}
      {marketNotes.map((m, i) => <div className="note" key={i}>{m}</div>)}
      {supplies === 0 && evenings.length > 0 && (
        <div className="note">
          You have a Making evening free and no {craft.supplyName}. Buy a batch under {supplyTitle} below first.
        </div>
      )}

      {pending.length > 0 && (
        <>
          <h2>Where does it go?</h2>
          <p className="sub">
            {pending.length === 1 ? "One sale" : `${pending.length} sales`} to decide. Each one is yours to place.
          </p>
          <form action={decideSalesAction}>
            <SalesForm
              fundraiser={(await openSalesFundraiser(me.id))?.cause}
              sales={pending.map((s) => ({
                id: s.id,
                label: `${itemOf(craft, s.item)?.label ?? s.item}, ${shortDay(s.day)}`,
                price: gbpShort(s.price),
              }))}
            />
          </form>
        </>
      )}

      <h2>Stock</h2>
      <div className="card">
        {stockLines.length === 0 && <p className="sub">Nothing in stock.</p>}
        {stockLines.map((i) => (
          <div className="row" key={i.key}>
            <span className="label">
              {i.label}
              <span className="blurb">{gbpShort(i.price)} each</span>
            </span>
            <span className="amount">{stock[i.key]}</span>
          </div>
        ))}
        {stockTotal > 0 && (
          <div className="row">
            <span className="label">
              Waiting for a market
              <span className="blurb">It doesn&apos;t sell itself, and it doesn&apos;t spoil.</span>
            </span>
            <span className="amount">{gbpShort(stockValue)}</span>
          </div>
        )}
      </div>

      <h2>{supplyTitle}</h2>
      <div className="card">
        <div className="row">
          <span className="label">
            Batches in the cupboard
            <span className="blurb">{gbpShort(craft.batchCost)} a batch. It comes out of Goals first, then Enjoyment, so you need money in one of them.</span>
          </span>
          <span className={`amount${supplies === 0 ? " zero" : ""}`}>{supplies}</span>
        </div>
        <form action={buySuppliesAction}>
          {[1, 2, 3].map((c) => (
            <button key={c} type="submit" name="count" value={c}>
              Buy {c === 1 ? "a batch" : `${c} batches`} ({gbpShort(craft.batchCost * c)})
            </button>
          ))}
        </form>
      </div>

      <h2>Making</h2>
      {projectItem && project && (
        <div className="note">
          {projectItem.label} in progress: {project.evenings_done} of {projectItem.evenings} evenings done.
        </div>
      )}
      {evenings.length === 0 && (
        <div className="card">
          <p className="sub">No making evenings free. Plan one on payday.</p>
        </div>
      )}
      {evenings.map((ev) => (
        <div className="card" key={ev.id}>
          <p><strong>{shortDay(ev.day)} evening</strong></p>
          <form action={makeAction}>
            <input type="hidden" name="evening_id" value={ev.id} />
            {craft.items
              .filter((i) => !project || i.key === project.item)
              .map((i) => (
                <button
                  key={i.key}
                  type="submit"
                  name="item"
                  value={i.key}
                  disabled={!project && supplies < i.batches}
                >
                  {project ? "Carry on with " : ""}{i.label}
                </button>
              ))}
          </form>
        </div>
      ))}

      <h2>What you make</h2>
      <div className="card">
        {craft.items.map((i) => (
          <div className="row" key={i.key}>
            <span className="label">
              {i.label}
              <span className="blurb">
                {i.evenings} evening{i.evenings === 1 ? "" : "s"}, {i.batches} batch{i.batches === 1 ? "" : "es"}, makes {i.yields}. {i.appeal >= 0.9 ? "Asked for often." : i.appeal >= 0.5 ? "Asked for sometimes." : "Rarely asked for."} {i.blurb}
              </span>
            </span>
            <span className="amount">{gbpShort(i.price)}</span>
          </div>
        ))}
      </div>

      <h2>Market</h2>
      <div className="card">
        {nextMarket && (
          <div className="row">
            <span className="label">
              Next market
              <span className="blurb">Demand is anyone&apos;s guess until the day.</span>
            </span>
            <span className="amount">{shortDay(nextMarket)} {nextMarket.slice(8, 10)}/{nextMarket.slice(5, 7)}</span>
          </div>
        )}
        {markets.length === 0 && <p className="sub">No market yet.</p>}
        {markets.map((m) => (
          <div className="row" key={m.day}>
            <span className="label">
              {shortDay(m.day)} {m.day.slice(8, 10)}/{m.day.slice(5, 7)}
              <span className="blurb">{bandCopy[m.band]} {m.capacity === 0 ? "" : `Sold ${m.sold} of ${m.capacity} who came.`}</span>
            </span>
            <span className={`amount${m.revenue === 0 ? " zero" : ""}`}>{gbp(m.revenue)}</span>
          </div>
        ))}
      </div>

      <Nav on="hustle" />
    </main>
  );
}
