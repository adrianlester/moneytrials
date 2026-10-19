import { redirect } from "next/navigation";
import Link from "next/link";
import { q, one } from "@/lib/db";
import { currentPlayer } from "@/lib/auth";
import { currentSeason } from "@/lib/seed";
import { gbp } from "@/lib/money";
import { ENVELOPES } from "@/lib/envelopes";
import {
  MAX_OPEN_GOALS, cardForPlayer, checkEnjoymentDepletion, dealCard, endSeasonIfDone, envelopes,
  eveningsFor, londonToday, resolveEveningsUpTo, resolveWeek, shortDay,
  weekFor, weekdayOf,
} from "@/lib/engine";
import { EVENINGS } from "@/lib/evenings";
import { craftRule } from "@/lib/hustle-data";
import { pendingSales, resolveMarkets } from "@/lib/hustle";
import { takeNotices } from "@/lib/rollover";
import { ensureAsks, myFundraiser, openAsks, upcomingScheduled } from "@/lib/asks";
import {
  addGoalAction, answerAskAction, buyGoalAction, resolveCardAction, startFundraiserAction,
} from "./actions";
import { Nav } from "./nav";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ gn?: string; ge?: string; an?: string; ae?: string }>;
}) {
  const { gn, ge, an, ae } = await searchParams;
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role === "admin") redirect("/admin");
  if (me.role === "player" && !me.setup_done) redirect("/start");

  const day = londonToday();
  // Once the last week has closed the season is over and the player gets their report.
  if (season.status === "ended" || (await endSeasonIfDone(season.id, day))) redirect("/report");

  if (season.status === "paused") {
    return (
      <main>
        <h1>{season.name}</h1>
        <p className="sub">The season is paused.</p>
        <div className="card">
          <p>Nothing moves until it starts again. Your money and your goals are exactly as you left them.</p>
        </div>
        <Nav on="home" />
      </main>
    );
  }

  const week = await weekFor(season.id, day);

  if (!week) {
    return (
      <main>
        <h1>{season.name}</h1>
        <p className="sub">The season isn&apos;t running today.</p>
        <div className="card">
          <p>It starts {String(season.start_date).slice(0, 10)} and runs {season.weeks} weeks.</p>
        </div>
        <Nav on="home" />
      </main>
    );
  }

  // Close out any week that has finished, so streaks are right on arrival.
  const finished = await q<{ id: string; season_id: string; idx: number; opens_at: string; closes_at: string }>(
    `SELECT id, season_id, idx, opens_at, closes_at FROM week
      WHERE season_id = $1 AND closes_at < $2 ORDER BY idx`,
    [season.id, day],
  );
  for (const w of finished) await resolveWeek(me.id, w);

  // Evenings resolve on arrival, before balances are read — an evening out that
  // has already happened must be paid for before today's card asks for money.
  const eveningNotes = await resolveEveningsUpTo(me.id, day);

  // Markets run on arrival too, so a sale waiting on a decision shows up here.
  const craft = craftRule(me.craft);
  const marketNotes = craft
    ? await resolveMarkets(me.id, craft, season.id, season.payday_weekday, day)
    : [];
  const salesWaiting = craft ? (await pendingSales(me.id)).length : 0;

  // Anything the day-rollover cron resolved while they were away.
  const waiting = await takeNotices(me.id);

  const depletion = await checkEnjoymentDepletion(me.id, week.id, day);

  await ensureAsks({ ...season, charity_frequency: season.charity_frequency });
  const asks = await openAsks(me.id, season.id, day);
  const coming = await upcomingScheduled(season.id, day);
  const fundraiser = await myFundraiser(me.id, day);

  const dealt = await dealCard(me.id, me.deck_id ?? "standard", week.id, day, me.craft);
  const envs = await envelopes(me.id);
  const allGoals = await q<{ id: string; name: string; target_amount: number; saved_amount: number; reached_at: string | null; bought_at: string | null }>(
    `SELECT id, name, target_amount, saved_amount, reached_at, bought_at FROM goal
      WHERE player_id = $1 ORDER BY created_at`,
    [me.id],
  );
  const goals = allGoals.filter((g) => !g.bought_at);
  const owned = allGoals.filter((g) => g.bought_at);

  const streakRow = await one<{ streak: number }>(
    `SELECT wr.streak FROM week_result wr JOIN week w ON w.id = wr.week_id
      WHERE wr.player_id = $1 ORDER BY w.idx DESC LIMIT 1`,
    [me.id],
  );

  const evenings = await eveningsFor(me.id, week.id);
  const tonight = evenings.find((e) => e.day === day) ?? null;
  const eveningsLeft = evenings.filter((e) => !e.resolved_at && !e.taken_by).length;

  const roll = await one<{ allocated: boolean; amount: number }>(
    `SELECT allocated, amount FROM wage_roll WHERE player_id = $1 AND week_id = $2`,
    [me.id, week.id],
  );
  const isPayday = weekdayOf(day) === season.payday_weekday;
  const paydayDue = !roll || !roll.allocated;

  const resolved = dealt?.inst.choice != null;
  const outcome = dealt?.inst.outcome_json
    ? (JSON.parse(dealt.inst.outcome_json) as { lines: string[]; failed: boolean })
    : null;

  // Comparison view: what the other player did with the same card. Read-only,
  // no commentary — the spec is explicit that this carries no judgement.
  // Their label comes from THEIR variant, not yours — Sam's card said "Strings"
  // where Robin's said "Exam entry", and she should be quoted in her own words.
  // It also stops a variant with different option ids rendering as a bare dash.
  const others = resolved
    ? await q<{ display_name: string; choice: string | null; card_id: string; craft: string | null }>(
        `SELECT p.display_name, ei.choice, ei.card_id, p.craft
           FROM event_inst ei JOIN player p ON p.id = ei.player_id
          WHERE ei.day = $1 AND ei.player_id <> $2 AND p.role = 'player'
            AND ei.choice IS NOT NULL`,
        [day, me.id],
      )
    : [];

  // Resolve from the RAW card, not from mine — mine already has my variant applied,
  // and layering theirs on top of it would leave my wording wherever they have none.
  // Their choice is worded from MY deck: another deck's amounts would show that decks differ.
  const theirLabels = new Map<string, string>();
  for (const o of others) {
    const theirCard = dealt ? await cardForPlayer(dealt.card.id, me.deck_id, o.craft) : null;
    const label = theirCard?.options.find((x) => x.id === o.choice)?.label;
    theirLabels.set(o.display_name, label ?? "—");
  }

  return (
    <main>
      <h1>{me.display_name}</h1>
      <p className="sub">
        Week {week.idx} of {season.weeks}
        {streakRow?.streak ? <> · <span className="tag good">{streakRow.streak} week streak</span></> : null}
      </p>

      {waiting.map((n, i) => <div className="note" key={`nt${i}`}>{n}</div>)}
      {depletion && <div className="note">{depletion}</div>}
      {eveningNotes.map((n, i) => <div className="note" key={`ev${i}`}>{n}</div>)}
      {marketNotes.map((n, i) => <div className="note" key={`mk${i}`}>{n}</div>)}
      {salesWaiting > 0 && (
        <Link href="/hustle" className="btn primary">
          {salesWaiting === 1 ? "A sale is waiting on you" : `${salesWaiting} sales are waiting on you`}
        </Link>
      )}

      {isPayday && paydayDue && (
        <Link href="/payday" className="btn primary">It&apos;s payday — allocate your money</Link>
      )}
      {!isPayday && paydayDue && (
        <Link href="/payday" className="btn primary">Wage not allocated yet</Link>
      )}

      {an && <div className="note">{an}</div>}
      {ae && <div className="note err">{ae}</div>}
      {asks.map((a) => {
        const reserve = envs.find((e) => e.type === "giving_reserve")?.balance ?? 0;
        return (
          <div className="card big" key={a.id}>
            <p><strong>{a.title}</strong></p>
            <p>{a.body}</p>
            {a.fundraiser && (
              <p className="sub">
                {gbp(a.fundraiser.raised)} raised so far, of a {gbp(a.fundraiser.target)} target.
              </p>
            )}
            <p className="sub">Giving Reserve: {gbp(reserve)}. Open until {shortDay(a.closes)}.</p>
            <form action={answerAskAction}>
              <input type="hidden" name="ask_id" value={a.id} />
              {a.suggested.filter((s) => s <= reserve).map((s) => (
                <button key={s} type="submit" name="amount" value={(s / 100).toFixed(2)}>
                  Give {gbp(s)}
                </button>
              ))}
              {reserve > 0 && (
                <div className="field">
                  <label htmlFor={`c-${a.id}`}>Another amount</label>
                  <span className="pound"><input id={`c-${a.id}`} name="custom" inputMode="decimal" placeholder="0" autoComplete="off" /></span>
                  <button type="submit">Give that</button>
                </div>
              )}
              <button type="submit" name="amount" value="0">Not this time</button>
            </form>
          </div>
        );
      })}

      <h2>Today</h2>
      {!dealt && <div className="card"><p className="sub">No card today.</p></div>}

      {dealt && !resolved && (
        <div className="card big">
          <p><strong>{dealt.card.title}</strong></p>
          <p>{dealt.card.body}</p>
          <form action={resolveCardAction}>
            <input type="hidden" name="inst_id" value={dealt.inst.id} />
            <input type="hidden" name="card_id" value={dealt.card.id} />
            {dealt.card.options.map((o) => (
              <button key={o.id} type="submit" name="option_id" value={o.id}>
                {o.label}
              </button>
            ))}
          </form>
        </div>
      )}

      {dealt && resolved && (
        <div className="card big">
          <p><strong>{dealt.card.title}</strong></p>
          <p className="sub">
            You chose: {dealt.card.options.find((o) => o.id === dealt.inst.choice)?.label}
          </p>
          {outcome?.lines.map((l, i) => <div className="note" key={i}>{l}</div>)}
          {outcome?.failed && <div className="note err">An obligation went unpaid this week.</div>}
          {others.length > 0 && (
            <>
              <h2>They chose</h2>
              {others.map((o) => (
                <div className="row" key={o.display_name}>
                  <span className="label">{o.display_name}</span>
                  <span className="blurb">{theirLabels.get(o.display_name) ?? "—"}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {evenings.length > 0 && (
        <>
          <h2>Tonight</h2>
          <div className="card">
            {tonight ? (
              <div className="row">
                <span className="label">
                  {tonight.taken_by
                    ? "Taken off you"
                    : EVENINGS[tonight.kind].label}
                  <span className="blurb">
                    {tonight.taken_by
                      ? "Something else got this evening."
                      : tonight.kind === "going_out" && tonight.actual_cost > 0
                        ? `It cost ${gbp(tonight.actual_cost)}.`
                        : EVENINGS[tonight.kind].blurb}
                  </span>
                </span>
                <span className="amount">
                  {tonight.kind === "shift" ? `+${gbp(tonight.earned)}` : ""}
                </span>
              </div>
            ) : (
              <p className="sub">Nothing planned for tonight.</p>
            )}
            {tonight && !tonight.taken_by && (
              <div className="note" style={{ marginTop: 8 }}>
                {tonight.kind === "making" ? (
                  tonight.made_item ? (
                    "You've made something tonight. Nothing more to do."
                  ) : (
                    <>
                      This one is yours to use. <Link href="/hustle">Go to Hustle and choose what to make.</Link>
                    </>
                  )
                ) : tonight.kind === "shift" ? (
                  "Nothing to do. The shift pay is banked until payday."
                ) : tonight.kind === "going_out" ? (
                  "Nothing to do. What it cost shows here once the evening has happened."
                ) : (
                  "Nothing to do. A quiet one."
                )}
              </div>
            )}
            <div className="row">
              <span className="label">
                Evenings left this week
                <span className="blurb">Once they&apos;re gone they&apos;re gone.</span>
              </span>
              <span className={`amount${eveningsLeft === 0 ? " zero" : ""}`}>{eveningsLeft}</span>
            </div>
          </div>

          <div className="card">
            {evenings.map((ev) => (
              <div className="row" key={ev.id}>
                <span className="label">
                  {shortDay(ev.day)}
                  {ev.day === day && <span className="blurb">tonight</span>}
                </span>
                <span
                  className={`amount${ev.taken_by ? " neg" : ev.resolved_at ? " zero" : ""}`}
                >
                  {ev.taken_by ? "taken" : EVENINGS[ev.kind].label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {coming.length > 0 && (
        <>
          <h2>Coming up</h2>
          <div className="card">
            {coming.map((a) => (
              <div className="row" key={a.id}>
                <span className="label">
                  {a.title}
                  <span className="blurb">Save toward it in your Giving Reserve.</span>
                </span>
                <span className="amount zero">{shortDay(a.day)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>Envelopes</h2>
      <div className="card">
        {envs.map((e) => {
          const rule = ENVELOPES[e.type];
          return (
            <div className="row" key={e.id}>
              <span className="label">
                {rule.label}
                <span className="blurb">{rule.blurb}</span>
                {(e.type === "giving_reserve" || e.type === "committed_giving") && (
                  <span className="locked">can&apos;t be taken back out</span>
                )}
                {e.type === "bills" && <span className="locked">locked once assigned</span>}
              </span>
              <span className={`amount${e.balance === 0 ? " zero" : ""}`}>{gbp(e.balance)}</span>
            </div>
          );
        })}
      </div>

      <h2>Your fundraiser</h2>
      {fundraiser && (
        <div className="card">
          <div className="goal-head">
            <span className="n">{fundraiser.cause}</span>
            <span className="p">{gbp(fundraiser.raised)} of {gbp(fundraiser.target)}</span>
          </div>
          <div className="bar">
            <span style={{ width: `${Math.min(100, Math.round((fundraiser.raised / fundraiser.target) * 100))}%` }} />
          </div>
          <p className="sub" style={{ marginTop: 10 }}>
            {fundraiser.open ? `Open until ${shortDay(fundraiser.closes)}.` : "Finished."}
            {fundraiser.sponsors.length === 0 && fundraiser.fromSales === 0 ? " Nobody has sponsored yet." : ""}
            {fundraiser.open && fundraiser.method === "sales" ? " Choose Fundraiser when you place a sale." : ""}
          </p>
          {fundraiser.matched > 0 && (
            <div className="row">
              <span className="label">Added by your parent</span>
              <span className="amount">{gbp(fundraiser.matched)}</span>
            </div>
          )}
          {fundraiser.fromSales > 0 && (
            <div className="row">
              <span className="label">Your own sales</span>
              <span className="amount">{gbp(fundraiser.fromSales)}</span>
            </div>
          )}
          {fundraiser.sponsors.map((s, i) => (
            <div className="row" key={i}>
              <span className="label">{s.name}</span>
              <span className="amount">{gbp(s.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {(!fundraiser || !fundraiser.open) && (
        <details className="card">
          <summary>Start a fundraiser</summary>
          <p className="hint" style={{ marginTop: 10 }}>
            It goes to the other player as a card and they can sponsor it from their own Giving
            Reserve. Nothing comes out of your money.
          </p>
          <form action={startFundraiserAction}>
            <div className="field">
              <label htmlFor="f_cause">What is it for?</label>
              <input id="f_cause" name="cause" placeholder="Air ambulance, a school trip fund" autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="f_target">Target</label>
              <span className="pound">
                <input id="f_target" name="target" inputMode="decimal" placeholder="0" autoComplete="off" />
              </span>
            </div>
            <div className="field">
              <label htmlFor="f_method">How are you raising it?</label>
              <select id="f_method" name="method" defaultValue="event">
                <option value="event">A sponsored event</option>
                <option value="sales">Selling things</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f_why">A line about it (optional)</label>
              <input id="f_why" name="why" autoComplete="off" />
            </div>
            <button type="submit">Start it</button>
          </form>
        </details>
      )}

      <h2>Goals</h2>
      {gn && <div className="note">{gn}</div>}
      {ge && <div className="note err">{ge}</div>}
      {goals.length === 0 && <div className="card"><p className="sub">You have no goals yet. Add one below: a name and a price.</p></div>}
      {goals.map((g) => {
        const pct = Math.min(100, Math.round((g.saved_amount / g.target_amount) * 100));
        const funded = g.saved_amount >= g.target_amount;
        return (
          <div className="card" key={g.id}>
            <div className="goal-head">
              <span className="n">{g.name}</span>
              <span className="p">{gbp(g.saved_amount)} of {gbp(g.target_amount)}</span>
            </div>
            <div className="bar"><span style={{ width: `${pct}%` }} /></div>
            {funded && (
              <form action={buyGoalAction} style={{ marginTop: 12 }}>
                <input type="hidden" name="goal_id" value={g.id} />
                <button type="submit" className="primary">Buy it ({gbp(g.target_amount)})</button>
              </form>
            )}
          </div>
        );
      })}

      {goals.length < MAX_OPEN_GOALS && (
        <form action={addGoalAction} className="card">
          <div className="field">
            <label htmlFor="goal_name">Add a goal</label>
            <input id="goal_name" name="name" placeholder="What is it?" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="goal_price">Price</label>
            <span className="pound"><input id="goal_price" name="price" inputMode="decimal" placeholder="0" autoComplete="off" /></span>
          </div>
          <button type="submit">Add it</button>
        </form>
      )}

      {owned.length > 0 && (
        <>
          <h2>Bought</h2>
          <div className="card">
            {owned.map((g) => (
              <div className="row" key={g.id}>
                <span className="label">{g.name}</span>
                <span className="amount">{gbp(g.target_amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <h2>More</h2>
      <div className="card">
        <div className="row">
          <span className="label">Your account<span className="blurb">Change your giving</span></span>
          <Link href="/account">Open</Link>
        </div>
        <div className="row">
          <span className="label">So far<span className="blurb">Survival, goals and giving</span></span>
          <Link href="/report">Open</Link>
        </div>
      </div>

      <Nav on="home" />
    </main>
  );
}
