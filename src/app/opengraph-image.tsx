import { ImageResponse } from "next/og";

// The preview card shown when a link to the site is shared (LinkedIn, Slack, messages).
export const alt = "The Money Trials: a 12-week budgeting game for teenagers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ENVELOPES = ["Bills", "Goals", "Enjoyment", "Giving Reserve", "Committed Giving"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between",
          background: "#12131a", color: "#f0f1f5", padding: "72px 80px", fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 30, color: "#6ee7a8", fontWeight: 700, letterSpacing: 2 }}>THE MONEY TRIALS</div>
          <div style={{ fontSize: 68, fontWeight: 700, marginTop: 24, lineHeight: 1.1 }}>
            A 12-week budgeting game for teenagers
          </div>
          <div style={{ fontSize: 32, color: "#9aa0b4", marginTop: 28 }}>
            Every pound of a Saturday-job wage gets a job before the week can start.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          {ENVELOPES.map((e) => (
            <div
              key={e}
              style={{
                display: "flex", fontSize: 24, padding: "12px 20px", borderRadius: 14,
                background: "#1c1e28", border: "2px solid #333747", color: "#f0f1f5",
              }}
            >
              {e}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
