import { redirect } from "next/navigation";
import Link from "next/link";
import { one } from "@/lib/db";
import { currentPlayer } from "@/lib/auth";
import { currentSeason, causesFor } from "@/lib/seed";
import { gbp } from "@/lib/money";
import { currentLoan, loanTerms, pendingCommitmentRequest } from "@/lib/loans";
import {
  acceptLoanAction, declineOfferAction, requestCommitmentAction, requestLoanAction, setCauseAction,
} from "../actions";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

/** Loans and Committed Giving, the two things a player can ask the admin for. */
export default async function Account({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; e?: string }>;
}) {
  const { m, e } = await searchParams;
  const me = await currentPlayer();
  if (!me) redirect("/login");
  if (me.role === "admin") redirect("/admin");
  const season = await currentSeason();
  if (!season) redirect("/setup");

  const loan = await currentLoan(me.id);
  const admin = await one<{ display_name: string }>(
    `SELECT display_name FROM player WHERE season_id = $1 AND role = 'admin' LIMIT 1`, [season.id],
  );
  const commit = await one<{ amount: number; cause_id: string | null; cause: string | null }>(
    `SELECT c.amount, c.cause_id, cs.name AS cause FROM commitment c
       LEFT JOIN cause cs ON cs.id = c.cause_id WHERE c.player_id = $1`, [me.id],
  );
  const pending = await pendingCommitmentRequest(me.id);
  const causes = await causesFor(season.id);


  const canAsk = !loan || loan.status === "declined" || loan.status === "repaid";

  return (
    <main>
      <h1>Your account</h1>
      <p className="sub">Things you can ask {admin?.display_name ?? "your parent"} for.</p>
      {m && <div className="note">{m}</div>}
      {e && <div className="note err">{e}</div>}

      <h2>Loan</h2>
      {loan?.status === "requested" && (
        <div className="card">
          <p>You asked for {gbp(loan.asked_amount)}. Waiting to hear back.</p>
        </div>
      )}
      {loan?.status === "offered" && (
        <div className="card big">
          <p><strong>Terms for a loan of {gbp(loan.principal)}</strong></p>
          <p>{loanTerms(loan, admin?.display_name ?? "your parent")}</p>
          <form action={acceptLoanAction}>
            <input type="hidden" name="loan_id" value={loan.id} />
            <button type="submit" className="primary">Accept these terms</button>
          </form>
          <form action={declineOfferAction}>
            <input type="hidden" name="loan_id" value={loan.id} />
            <button type="submit">No thanks</button>
          </form>
        </div>
      )}
      {loan?.status === "active" && (
        <div className="card">
          <div className="row">
            <span className="label">Still to pay back</span>
            <span className="amount">{gbp(loan.outstanding)}</span>
          </div>
          <div className="row">
            <span className="label">Each payday</span>
            <span className="amount">{gbp(Math.min(loan.weekly_repayment, loan.outstanding))}</span>
          </div>
          <p className="hint">Taken out at payday before you allocate anything. No interest.</p>
        </div>
      )}
      {loan?.status === "repaid" && <div className="note">Your last loan is paid off.</div>}
      {loan?.status === "declined" && <div className="note">Your last request wasn&apos;t taken up.</div>}
      {canAsk && (
        <form action={requestLoanAction} className="card">
          <div className="field">
            <label htmlFor="loan_amount">Ask for a loan</label>
            <span className="pound">
              <input id="loan_amount" name="amount" inputMode="decimal" placeholder="0" autoComplete="off" />
            </span>
          </div>
          <div className="field">
            <label htmlFor="loan_reason">What for? (optional)</label>
            <input id="loan_reason" name="reason" autoComplete="off" />
          </div>
          <button type="submit">Ask</button>
          <p className="hint" style={{ marginTop: 10 }}>
            You&apos;ll see the terms before any money moves, and you can say no to them.
          </p>
        </form>
      )}

      <h2>Committed Giving</h2>
      <div className="card">
        <div className="row">
          <span className="label">
            {gbp(commit?.amount ?? 0)} a week
            <span className="blurb">{commit?.cause ? `To ${commit.cause}. ` : "No cause chosen yet. "}It leaves every payday on its own.</span>
          </span>
        </div>
        <form action={setCauseAction}>
          <div className="field">
            <label htmlFor="cause_id">Change the cause (any time)</label>
            <select id="cause_id" name="cause_id" defaultValue={commit?.cause_id ?? ""}>
              {causes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <button type="submit">Change cause</button>
        </form>
      </div>
      {pending ? (
        <div className="note">
          You asked to change it to {gbp(pending.new_amount)} a week. Waiting for {admin?.display_name ?? "your parent"} to say yes.
        </div>
      ) : (
        <form action={requestCommitmentAction} className="card">
          <div className="field">
            <label htmlFor="new_amount">Ask to change the amount</label>
            <span className="pound">
              <input id="new_amount" name="amount" inputMode="decimal" placeholder="0" autoComplete="off" />
            </span>
          </div>
          <button type="submit">Ask</button>
          <p className="hint" style={{ marginTop: 10 }}>
            The amount is fixed for the season unless it&apos;s approved. If it is, it changes from the next payday.
          </p>
        </form>
      )}

      <p className="sub"><Link href="/">Back to Today</Link></p>
      <Nav on="home" />
    </main>
  );
}
