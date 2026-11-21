// Shared header for the two hubs. Work = Matters · Quotes · Outreach. Memory = Contacts · Documents · Deadlines.
// Tabs are plain links, so every old URL (/matters, /compare, /outreach, /contacts, /documents, /deadlines) is still a real page.
import Link from "next/link";
import type { ReactNode } from "react";
import { Headline, Lede } from "../ui";

type Counts = { business: boolean; matters: number; quotes: number; campaigns: number; contacts: number; documents: number; deadlines: number };
export type HubTab = "matters" | "quotes" | "outreach" | "contacts" | "documents" | "deadlines";

const tabsFor = (c: Counts): Record<"work" | "memory", { key: HubTab; href: string; label: string; n: number }[]> => ({
  work: [
    { key: "matters", href: "/matters", label: c.business ? "Matters" : "Purchases", n: c.matters },
    { key: "quotes", href: "/compare", label: "Quotes", n: c.quotes },
    { key: "outreach", href: "/outreach", label: "Outreach", n: c.campaigns },
  ],
  memory: [
    { key: "contacts", href: "/contacts", label: c.business ? "Contacts" : "Suppliers", n: c.contacts },
    { key: "documents", href: "/documents", label: "Documents", n: c.documents },
    { key: "deadlines", href: "/deadlines", label: "Deadlines", n: c.deadlines },
  ],
});

export function HubHeader({ hub, tab, counts, lead, rest, note, actions }: { hub: "work" | "memory"; tab: HubTab; counts: Counts; lead: ReactNode; rest?: ReactNode; note?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="enter mb-9">
      <div className="text-[12.5px] font-medium text-faint mb-3 capitalize">{hub}</div>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 max-w-[760px]">
          <Headline lead={lead} rest={rest} />
          {note && <Lede>{note}</Lede>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <nav aria-label={`${hub} sections`} className="mt-7 inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-full bg-card/70 border border-line shadow-bento">
        {tabsFor(counts)[hub].map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === tab ? "page" : undefined}
            className={`press inline-flex items-center gap-2 h-9 px-4 rounded-full text-[13.5px] font-medium whitespace-nowrap transition-colors ${t.key === tab ? "bg-ink text-white" : "text-ink-2 hover:bg-hover"}`}>
            {t.label}
            <span className={`tabular text-[12px] ${t.key === tab ? "text-white/60" : "text-faint"}`}>{t.n}</span>
          </Link>
        ))}
      </nav>
    </header>
  );
}
