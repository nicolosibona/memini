import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { LiveUpdates } from "@/components/LiveUpdates";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { openAlerts } from "@/lib/core/audit";
import { comparableGroups } from "@/lib/core/matters";
import { wecomConfigured } from "@/lib/channels/wecom";
import { today } from "@/lib/db";
import { pulse } from "@/lib/pulse";

// Fonts are self-hosted (app/fonts): no request to Google, so they load in mainland China too.
const geist = localFont({ src: "./fonts/Geist-Variable.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });
const instrument = localFont({
  src: [{ path: "./fonts/instrument-serif-latin-400-normal.woff2", style: "normal" }, { path: "./fonts/instrument-serif-latin-400-italic.woff2", style: "italic" }],
  variable: "--font-instrument", weight: "400", display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Memini", template: "%s · Memini" },
  description: "Your bilingual assistant for doing business in China: counterparties, matters, documents and deadlines in one memory.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#faf9f7" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const db = await appDb();
  const profile = workspaceProfile(db);
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const counts = {
    inbox: n(`SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ? AND status = 'pending' AND intent = 'content'`, CURRENT_WS),
    overdue: n(`SELECT COUNT(*) AS n FROM tasks WHERE workspace_id = ? AND status = 'open' AND due_at < ?`, CURRENT_WS, today()),
    alerts: openAlerts(db, { workspaceId: CURRENT_WS }).filter((a) => a.severity === "red").length,
    compare: comparableGroups(db, CURRENT_WS).some((g) => g.matters.length > 1),
    profileLabel: profile.def.label,
    business: profile.key === "china_business",
    wechat: wecomConfigured() ? (n(`SELECT COUNT(*) AS n FROM users WHERE wecom_external_userid IS NOT NULL`) ? "linked" : "ready") : "off",
  } as const;
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} ${instrument.variable}`}>
      <body className="antialiased min-h-screen md:flex">
        <Sidebar counts={counts} />
        <main className="flex-1 min-w-0">{children}</main>
        <LiveUpdates initial={pulse(db, CURRENT_WS).v} />
      </body>
    </html>
  );
}
