import { appDb, CURRENT_WS } from "@/lib/server";
import { pulse } from "@/lib/pulse";
import { LiveUpdates } from "@/components/LiveUpdates";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { Shell } from "@/components/shell/Shell";
import { navCounts, searchIndex } from "@/components/shell/data";

// The workspace: floating nav, one shared conversation, slide-over drawers, live refresh.
export default async function AppLayout({ children, drawer }: { children: React.ReactNode; drawer: React.ReactNode }) {
  const db = await appDb();
  return (
    <ChatProvider>
      <Shell counts={navCounts(db)} index={searchIndex(db)} drawer={drawer}>{children}</Shell>
      <LiveUpdates initial={pulse(db, CURRENT_WS).v} />
    </ChatProvider>
  );
}
