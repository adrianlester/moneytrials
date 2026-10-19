import Link from "next/link";
import { Nav } from "../nav";

export const dynamic = "force-dynamic";

/**
 * The how-to-play page. Reachable from the Help tab at any time, and from the first-time
 * setup screen. Plain words, written for teenagers. If a rule changes in the
 * engine, change it here too.
 */
export default function Help() {
  return (
    <main>
      <h1>How it works</h1>
      <p className="sub">Twelve weeks. Every pound gets a job. Come back here whenever you like.</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The idea</h2>
        <p>
          You are 16 and you have a Saturday job. You pay for your own phone, bus, clothes, treats
          and gifts. The money is pretend and the prices are real. Nobody is marking you. The
          point is to see what your choices cost.
        </p>
        <p>
          One real day is one game day. Once a week you sit down for about three minutes and
          plan. The other days take about thirty seconds.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Payday (once a week)</h2>
        <p>Your wage lands. It is about £95 but it is not the same every week. Some weeks are short, some are bigger, and now and then there is nothing.</p>
        <p>You see next week&apos;s hours on payday, and no further ahead.</p>
        <p>
          You give every pound a job by sharing it between the envelopes below. The week can&apos;t
          start until you have used it all. If you leave some over, it gets spent on something
          small and you are told what.
        </p>
        <p>You also plan your five evenings for the week at the same time.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The envelopes</h2>
        <div className="row">
          <span className="label">Bills<span className="blurb">Phone, bus, subscriptions. Once it is in, it stays in. If a bill goes unpaid, the week counts as failed.</span></span>
        </div>
        <div className="row">
          <span className="label">Goals<span className="blurb">The things you are saving for. You can raid it in an emergency, and that breaks your streak.</span></span>
        </div>
        <div className="row">
          <span className="label">Enjoyment<span className="blurb">Going out, treats, anything you like. If it sits at nothing for more than ten days, the game buys you something on impulse.</span></span>
        </div>
        <div className="row">
          <span className="label">Committed Giving<span className="blurb">An amount you choose at the start. It leaves every payday on its own. Nobody can take it back out.</span></span>
        </div>
        <div className="row">
          <span className="label">Giving Reserve<span className="blurb">Kept back for when someone asks. It builds all season. Once it is in, it can&apos;t be taken back out.</span></span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your five evenings</h2>
        <p>Each week has five evenings and each one goes to one thing. Time is the other thing you are spending.</p>
        <div className="row">
          <span className="label">Extra shift<span className="blurb">£22 and the evening is gone. Two a week at most. It is held until payday so it gets a job too.</span></span>
        </div>
        <div className="row">
          <span className="label">Making<span className="blurb">Turn supplies into things to sell. You choose what on the Hustle tab.</span></span>
        </div>
        <div className="row">
          <span className="label">Going out<span className="blurb">Costs between £8 and £25. You only find out the price on the night.</span></span>
        </div>
        <div className="row">
          <span className="label">Nothing<span className="blurb">No cost and no gain. That is a fine choice.</span></span>
        </div>
        <p>Sometimes a card takes one of your evenings. You are told what it cost you.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The Today tab</h2>
        <p><strong>Today&apos;s card.</strong> One card a day, the same for both of you. Pick an option. Both options are reasonable. After you choose, you can see what the other player picked.</p>
        <p><strong>Tonight.</strong> This shows what you planned for this evening. Most evenings there is nothing to do. For a Making evening, tap the link to the Hustle tab and make something.</p>
        <p><strong>Coming up.</strong> Appeals that are on the calendar. You can save toward them.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The Hustle tab</h2>
        <p>Your craft is your own business. It runs in four steps.</p>
        <p>1. Buy supplies. This costs real money before you earn anything.</p>
        <p>2. Spend Making evenings turning supplies into things to sell.</p>
        <p>3. Your stock waits. It does not sell by itself.</p>
        <p>4. On market day, buyers come. Some weeks they buy nothing.</p>
        <p>
          After a sale you choose where each pound goes: to you, or to your Giving Reserve. You
          choose once you know the amount. It can lose money. That is part of it.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Giving</h2>
        <p>
          Sometimes someone asks you for money: a school collection, a friend&apos;s sponsored
          run, an appeal on the news. You can only give from your Giving Reserve. You can give
          what is suggested, give your own amount, or say not this time. Saying no costs nothing.
        </p>
        <p>
          You can also run a fundraiser of your own. It goes to the other player as a card, and
          they can sponsor you from their own Giving Reserve. If you choose to raise money by selling, you can send a sale to your fundraiser when you place it on the Hustle tab, and it counts toward the total. Your own envelopes do not move.
        </p>
        <p>Giving is shown at the end of the season. It is never scored.</p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Loans and changing your giving</h2>
        <p>
          Under More on the Today tab there is Your account. You can ask for a loan there. Your
          parent sets the terms and you read them before any money moves. You can say no. If you say
          yes, the money arrives with your next wage and a repayment comes out at each payday
          before you allocate anything. There is no interest. A payment you can&apos;t cover fails
          that week and is still owed.
        </p>
        <p>
          Your Committed Giving amount is fixed for the season. You can ask to change it and your
          parent decides. You can change the cause whenever you like.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>The end of the season</h2>
        <p>
          When week twelve is over you get a report with three separate results: Survival, Goals and
          Given. They are never added together. You can look at how you are doing so far at any
          time under More on the Today tab.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Goals</h2>
        <p>
          Name two or three things you really want, with their real prices. Your Goals pot fills
          them in order. When one is fully funded you can buy it and the pot moves on to the
          next. You can add a goal any time, up to three open at once.
        </p>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Surviving a week</h2>
        <p>
          You survive a week by paying every bill. That adds a point and keeps your streak going.
          A failed week is a setback. It is not the end, and you can recover.
        </p>
        <p>At the end of the season you get three separate results: weeks survived, goals reached, and what you gave. They are never added into one score.</p>
      </div>

      <p className="sub"><Link href="/">Back to Today</Link></p>
      <Nav on="help" />
    </main>
  );
}
