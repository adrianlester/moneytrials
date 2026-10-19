import { gbp } from "@/lib/money";
import type { Report } from "@/lib/report";

/**
 * Three separate things, never combined into one score (spec section 9). Plain voice, no praise
 * and no disappointment. A player who gave nothing is told that, and that is all.
 */
export function ReportView({ r, final }: { r: Report; final: boolean }) {
  const s = r.survival;
  const g = r.given;
  return (
    <>
      <h2>Survival</h2>
      <div className="card">
        <div className="row">
          <span className="label">Weeks survived</span>
          <span className="amount">{s.weeksSurvived} of {r.weeksPlayed}</span>
        </div>
        <div className="row">
          <span className="label">Longest streak</span>
          <span className="amount">{s.longestStreak}</span>
        </div>
        <div className="row">
          <span className="label">Obligations failed</span>
          <span className="amount">{s.obligationsFailed}</span>
        </div>
        {s.failedWeeks.map((w) => (
          <div className="row" key={w.week}>
            <span className="label">
              Week {w.week}
              <span className="blurb">{w.why.length ? w.why.join(". ") : "An obligation went unpaid."}</span>
            </span>
          </div>
        ))}
      </div>

      <h2>Goals</h2>
      <div className="card">
        {r.goals.length === 0 && <p className="sub">No goals were set.</p>}
        {r.goals.map((x, i) => (
          <div className="row" key={i}>
            <span className="label">
              {x.name}
              <span className="blurb">
                {x.status === "bought"
                  ? `Bought ${x.when}`
                  : x.status === "reached"
                    ? `Fully saved ${x.when}`
                    : `${gbp(x.saved)} of ${gbp(x.price)} saved`}
              </span>
            </span>
            <span className="amount">{gbp(x.price)}</span>
          </div>
        ))}
      </div>

      <h2>Given</h2>
      <div className="card">
        {g.total === 0 ? (
          <p>You gave nothing{final ? " this season" : " so far"}.</p>
        ) : (
          <>
            <div className="row">
              <span className="label">Total given</span>
              <span className="amount">{gbp(g.total)}</span>
            </div>
            {g.committed > 0 && (
              <div className="row">
                <span className="label">Committed Giving</span>
                <span className="amount">{gbp(g.committed)}</span>
              </div>
            )}
            {g.asks > 0 && (
              <div className="row">
                <span className="label">Asks and sponsoring</span>
                <span className="amount">{gbp(g.asks)}</span>
              </div>
            )}
            {g.fundraiser > 0 && (
              <div className="row">
                <span className="label">Your own sales, to your fundraiser</span>
                <span className="amount">{gbp(g.fundraiser)}</span>
              </div>
            )}
            <h2>To whom</h2>
            {g.byRecipient.map((x) => (
              <div className="row" key={x.to}>
                <span className="label">{x.to}</span>
                <span className="amount">{gbp(x.amount)}</span>
              </div>
            ))}
          </>
        )}
        {g.reserveLeft > 0 && (
          <div className="row">
            <span className="label">Still in the Giving Reserve<span className="blurb">Held back and not given.</span></span>
            <span className="amount">{gbp(g.reserveLeft)}</span>
          </div>
        )}
        {g.raised.map((f, i) => (
          <div className="row" key={i}>
            <span className="label">
              Your fundraiser: {f.cause}
              <span className="blurb">{f.matched > 0 ? `${gbp(f.matched)} of it was added by your parent.` : "Raised from sponsors and sales."}</span>
            </span>
            <span className="amount">{gbp(f.raised)} of {gbp(f.target)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
