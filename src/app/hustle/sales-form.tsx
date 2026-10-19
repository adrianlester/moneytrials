"use client";

import { useState } from "react";

export interface SaleRow {
  id: string;
  label: string;
  price: string;
}

/**
 * Where each sale's money goes, decided one sale at a time AFTER the amount is
 * known (spec §7). Nothing is selected to start with and the copy carries no
 * nudge either way. The button stays disabled until every sale has an answer,
 * so no decision is made by leaving it alone.
 */
export function SalesForm({ sales, fundraiser }: { sales: SaleRow[]; fundraiser?: string }) {
  const [dest, setDest] = useState<Record<string, "me" | "giving" | "fundraiser">>({});
  const options = fundraiser ? (["me", "giving", "fundraiser"] as const) : (["me", "giving"] as const);
  const ready = sales.every((s) => dest[s.id]);

  return (
    <>
      <div className="card">
        {sales.map((s) => (
          <div className="field" key={s.id}>
            <label>
              {s.label} — {s.price}
            </label>
            <div className="choices">
              {options.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`choice${dest[s.id] === d ? " on" : ""}`}
                  aria-pressed={dest[s.id] === d}
                  onClick={() => setDest((v) => ({ ...v, [s.id]: d }))}
                >
                  <span className="choice-label">{d === "me" ? "Mine" : d === "giving" ? "Giving Reserve" : `Fundraiser: ${fundraiser}`}</span>
                </button>
              ))}
            </div>
            <input type="hidden" name={`dest_${s.id}`} value={dest[s.id] ?? ""} />
          </div>
        ))}
      </div>
      <button className="primary" type="submit" disabled={!ready}>
        {ready ? "Decide" : "Decide every sale first"}
      </button>
    </>
  );
}
