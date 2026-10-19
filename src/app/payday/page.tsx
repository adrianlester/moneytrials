import { redirect } from "next/navigation";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { gbp, gbpShort } from "@/lib/money";
import { ALLOCATABLE_TYPES, ENVELOPES } from "@/lib/envelopes";
import { eveningDay, eveningsFor, envelopes, londonToday, paydayView, shortDay } from "@/lib/engine";
import { EVENINGS, EVENINGS_PER_WEEK } from "@/lib/evenings";
import { paydayAction } from "../actions";
import { Nav } from "../nav";
import { PaydayForm } from "./payday-form";

export const dynamic = "force-dynamic";

const BAND_COPY: Record<string, string> = {
  base: "A normal week on the rota.",
  reduced: "Short shift this week.",
  boosted: "Extra shift came up.",
  zero: "Shop was shut. Nothing this week.",
};

export default async function Payday({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const me = await currentPlayer();
  if (!me) redirect("/login");
  const season = await currentSeason();
  if (!season) redirect("/setup");
  if (season.status !== "running") redirect("/");

  const { e } = await searchParams;
  const day = londonToday();
  const view = await paydayView(me.id, season.id, day, me.base_wage, me.wage_variance);

  if (!view) {
    return (
      <main>
        <h1>Payday</h1>
        <p className="sub">The season isn&apos;t running today.</p>
        <Nav on="payday" />
      </main>
    );
  }

  const envs = await envelopes(me.id);
  const balanceOf = (t: string) => envs.find((x) => x.type === t)?.balance ?? 0;

  const eveningDays = Array.from({ length: EVENINGS_PER_WEEK }, (_, i) =>
    shortDay(eveningDay(view.week, i + 1)),
  );
  const planned = await eveningsFor(me.id, view.week.id);

  if (view.alreadyAllocated) {
    return (
      <main>
        <h1>Week {view.week.idx}</h1>
        <p className="sub">Already allocated. Nothing to do until next payday.</p>
        <div className="card">
          {ALLOCATABLE_TYPES.map((t) => (
            <div className="row" key={t}>
              <span className="label">{ENVELOPES[t].label}</span>
              <span className="amount">{gbp(balanceOf(t))}</span>
            </div>
          ))}
        </div>
        {planned.length > 0 && (
          <>
            <h2>Your evenings</h2>
            <div className="card">
              {planned.map((ev) => (
                <div className="row" key={ev.id}>
                  <span className="label">
                    {shortDay(ev.day)}
                    <span className="blurb">
                      {ev.taken_by
                        ? "Taken off you."
                        : ev.resolved_at
                          ? "Gone."
                          : EVENINGS[ev.kind].blurb}
                    </span>
                  </span>
                  <span className={`amount${ev.taken_by ? " neg" : ""}`}>
                    {EVENINGS[ev.kind].label}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        {view.nextWeek && (
          <>
            <h2>Next week&apos;s rota</h2>
            <div className="card">
              <div className="row">
                <span className="label">
                  Week {view.nextWeek.idx}
                  <span className="blurb">{BAND_COPY[view.nextWeek.band]}</span>
                </span>
                <span className="amount">{gbp(view.nextWeek.amount)}</span>
              </div>
            </div>
          </>
        )}
        <Nav on="payday" />
      </main>
    );
  }

  return (
    <main>
      <h1>Week {view.week.idx}</h1>
      <p className="sub">Every pound gets a job before the week starts.</p>

      {e && <div className="note err">{e}</div>}

      <div className="card">
        <div className="row">
          <span className="label">Wage<span className="blurb">{BAND_COPY[view.band]}</span></span>
          <span className="amount">{gbp(view.wage)}</span>
        </div>
        {view.banked > 0 && (
          <div className="row">
            <span className="label">Banked<span className="blurb">Earned mid-week</span></span>
            <span className="amount">{gbp(view.banked)}</span>
          </div>
        )}
        {view.committed > 0 && (
          <div className="row">
            <span className="label">
              Committed giving
              <span className="blurb">{view.committedCause ?? "your cause"} — goes automatically</span>
            </span>
            <span className="amount neg">−{gbpShort(view.committed)}</span>
          </div>
        )}
        <div className="row">
          <span className="label">To allocate</span>
          <span className="amount">{gbp(view.available)}</span>
        </div>
      </div>

      <form action={paydayAction}>
        <PaydayForm
          available={view.available}
          carried={Object.fromEntries(ALLOCATABLE_TYPES.map((t) => [t, balanceOf(t)]))}
          days={eveningDays}
        />
      </form>

      {view.nextWeek && (
        <>
          <h2>Next week&apos;s rota</h2>
          <div className="card">
            <div className="row">
              <span className="label">
                Week {view.nextWeek.idx}
                <span className="blurb">{BAND_COPY[view.nextWeek.band]}</span>
              </span>
              <span className="amount">{gbp(view.nextWeek.amount)}</span>
            </div>
          </div>
        </>
      )}

      <Nav on="payday" />
    </main>
  );
}
