import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { openAlerts } from "@/lib/core/audit";
import { comparableGroups } from "@/lib/core/matters";
import { today } from "@/lib/db";

export const metadata: Metadata = {
  title: { default: "Memini", template: "%s · Memini" },
  description: "Your bilingual assistant for doing business in China: counterparties, matters, documents and deadlines in one memory.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f6f3" };
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
  };
  return (
    <html lang="en">
      <body className="antialiased min-h-screen md:flex">
        <Sidebar counts={counts} />
        <main className="flex-1 min-w-0">
          <div className="max-w-[1080px] mx-auto px-4 sm:px-8 py-6 sm:py-8">{children}</div>
        </main>
      </body>
    </html>
  );
}
