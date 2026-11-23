import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoStrip } from "./demo-strip";
import { demoMode } from "@/lib/demo";

const TITLE = "The Money Trials: a budgeting game for teenagers";
const DESCRIPTION =
  "A 12-week budgeting game for teenagers. Each week players give every pound of a Saturday-job wage a job, " +
  "then answer one short money question a day. Built with Claude Code.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "The Money Trials",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12131a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <DemoStrip />
        <aside className="site-aside">
          <h2>The Money Trials</h2>
          <p>A 12-week budgeting game for teenagers, built for a phone. Every pound of the wage gets a job before the week can start.</p>
          {demoMode() && (
            <p>
              <a href="https://github.com/adrianlester/moneytrials/blob/main/WRITEUP.md">How it was built</a>
            </p>
          )}
        </aside>
        {children}
      </body>
    </html>
  );
}
