import type { Metadata, Viewport } from "next";
import "./globals.css";
import { DemoStrip } from "./demo-strip";

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
  maximumScale: 1,
  themeColor: "#12131a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <DemoStrip />
        {children}
      </body>
    </html>
  );
}
