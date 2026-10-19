"use client";

import { useMemo, useState } from "react";
import { gbp, gbpShort, parsePounds } from "@/lib/money";
import { ALLOCATABLE_TYPES, ENVELOPES } from "@/lib/envelopes";
import { EVENINGS, EVENING_KINDS, EVENINGS_PER_WEEK, MAX_SHIFTS_PER_WEEK, type EveningKind } from "@/lib/evenings";

/**
 * Payday is one decision made of two halves: where the money goes, and where the
 * evenings go. They share a form and a single gate, because the spec's point is
 * that both are scarce and both get assigned on purpose — a week that starts
 * with £12 spare and two blank evenings hasn't been planned.
 *
 * The money gate is strict (the designer's call, 18 Sep): it refuses a leftover rather
 * than absorbing it. The time gate is the same shape — all five or none.
 */
export function PaydayForm({
  available,
  carried,
  days,
}: {
  available: number;
  carried: Record<string, number>;
  days: string[];
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<(EveningKind | null)[]>(
    Array(EVENINGS_PER_WEEK).fill(null),
  );

  const assigned = useMemo(
    () =>
      ALLOCATABLE_TYPES.reduce((n, t) => {
        const v = (values[t] ?? "").trim();
        if (!v) return n;
        return n + (parsePounds(v) ?? 0);
      }, 0),
    [values],
  );

  const left = available - assigned;
  const unreadable = ALLOCATABLE_TYPES.some((t) => {
    const v = (values[t] ?? "").trim();
    return v !== "" && parsePounds(v) === null;
  });

  const eveningsChosen = plan.filter(Boolean).length;
  const shifts = plan.filter((k) => k === "shift").length;
  const out = plan.filter((k) => k === "going_out").length;

  const moneyReady = left === 0 && !unreadable;
  const timeReady = eveningsChosen === EVENINGS_PER_WEEK;
  const ready = moneyReady && timeReady;

  return (
    <>
      <div className="card">
        {ALLOCATABLE_TYPES.map((t) => (
          <div className="field" key={t}>
            <label htmlFor={`env_${t}`}>
              {ENVELOPES[t].label} — {ENVELOPES[t].blurb}
              {carried[t] > 0 && ENVELOPES[t].rollsOver
                ? ` (${gbpShort(carried[t])} carried over)`
                : ""}
            </label>
            <span className="pound"><input
              id={`env_${t}`}
              name={`env_${t}`}
              inputMode="decimal"
              placeholder="0"
              autoComplete="off"
              value={values[t] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [t]: e.target.value }))}
            /></span>
          </div>
        ))}
      </div>

      <div className="card" aria-live="polite">
        <div className="row">
          <span className="label">
            {left === 0 ? "Every pound has a job" : left > 0 ? "Still to assign" : "Over by"}
            {left > 0 && <span className="blurb">The week can&apos;t start until this is zero.</span>}
          </span>
          <span className={`amount${left === 0 ? "" : left < 0 ? " neg" : ""}`}>
            {gbp(Math.abs(left))}
          </span>
        </div>
      </div>

      {unreadable && <div className="note err">One of those isn&apos;t an amount I can read.</div>}

      <h2>Your five evenings</h2>
      <p className="sub">Time runs out the same way money does. Spend each one on purpose.</p>

      <div className="card">
        {plan.map((kind, i) => (
          <div className="field" key={i}>
            <label>{days[i]}</label>
            <div className="choices">
              {EVENING_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`choice${kind === k ? " on" : ""}`}
                  aria-pressed={kind === k}
                  disabled={k === "shift" && kind !== "shift" && shifts >= MAX_SHIFTS_PER_WEEK}
                  onClick={() =>
                    setPlan((p) => p.map((v, j) => (j === i ? (v === k ? null : k) : v)))
                  }
                >
                  <span className="choice-label">{EVENINGS[k].label}</span>
                  <span className="choice-blurb">{EVENINGS[k].blurb}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name={`evening_${i + 1}`} value={kind ?? ""} />
          </div>
        ))}
      </div>

      <div className="card" aria-live="polite">
        <div className="row">
          <span className="label">
            {timeReady ? "All five evenings are spoken for" : "Evenings still to decide"}
          </span>
          <span className="amount">{timeReady ? "✓" : EVENINGS_PER_WEEK - eveningsChosen}</span>
        </div>
        {shifts > 0 && (
          <div className="row">
            <span className="label">
              Extra shifts
              <span className="blurb">Banked — it arrives with next week&apos;s wage.</span>
            </span>
            <span className="amount">+{gbpShort(shifts * EVENINGS.shift.earns)}</span>
          </div>
        )}
        {out > 0 && (
          <div className="row">
            <span className="label">
              Going out
              <span className="blurb">You&apos;ll find out what each one costs on the night.</span>
            </span>
            <span className="amount neg">
              −{gbpShort(out * EVENINGS.going_out.costRange![0])} to −
              {gbpShort(out * EVENINGS.going_out.costRange![1])}
            </span>
          </div>
        )}
      </div>

      <button className="primary" type="submit" disabled={!ready}>
        {ready
          ? "Start the week"
          : !moneyReady
            ? "Assign it all first"
            : "Plan your evenings first"}
      </button>
    </>
  );
}
