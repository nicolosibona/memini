"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

type Item = { href: string; label: string; icon: string; badge?: number; tone?: "bad" | "neutral" };
export type NavCounts = { inbox: number; overdue: number; alerts: number; compare: boolean; profileLabel: string; business: boolean };

export function Sidebar({ counts }: { counts: NavCounts }) {
  const path = usePathname();
  if (path.startsWith("/s/")) return null; // the mobile page opened from WeChat has no app chrome

  const groups: { title?: string; items: Item[] }[] = [
    { items: [{ href: "/", label: "Today", icon: "home", badge: counts.alerts || undefined, tone: "bad" }, { href: "/inbox", label: "To file", icon: "inbox", badge: counts.inbox || undefined }] },
    {
      title: "Work",
      items: [
        { href: "/matters", label: counts.business ? "Matters" : "Purchases", icon: "folder" },
        { href: "/deadlines", label: "Deadlines", icon: "calendar", badge: counts.overdue || undefined, tone: "bad" },
        ...(counts.compare ? [{ href: "/compare", label: "Compare quotes", icon: "scale" }] : []),
      ],
    },
    { title: "Records", items: [{ href: "/contacts", label: counts.business ? "Contacts" : "Suppliers", icon: "users" }, { href: "/documents", label: "Documents", icon: "file" }] },
    { title: "Assistant", items: [{ href: "/ask", label: "Ask", icon: "chat" }, { href: "/sim", label: "WeChat simulator", icon: "phone" }] },
  ];
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

  return (
    <>
      {/* desktop */}
      <aside className="no-print hidden md:flex w-[232px] shrink-0 flex-col border-r border-line bg-card/60 h-screen sticky top-0">
        <Link href="/" className="flex items-center gap-2.5 px-5 h-14 border-b border-line">
          <span className="grid place-items-center size-7 rounded-md bg-brand text-white font-[family-name:var(--font-seal)] text-[15px] leading-none">印</span>
          <span className="font-semibold tracking-[-0.01em]">Memini</span>
        </Link>
        <Link href="/upload" className="mx-3 mt-3 mb-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink text-white text-[13px] font-medium py-2 hover:bg-ink-2 transition-colors">
          <Icon name="upload" className="size-3.5" /> Add documents
        </Link>
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          {groups.map((g, i) => (
            <div key={i} className="mb-3">
              {g.title && <div className="px-2 pt-2 pb-1 text-[11px] font-medium uppercase tracking-[0.06em] text-faint">{g.title}</div>}
              {g.items.map((it) => (
                <Link key={it.href} href={it.href} className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13.5px] transition-colors ${active(it.href) ? "bg-hover text-ink font-medium" : "text-ink-2 hover:bg-hover"}`}>
                  <Icon name={it.icon} className={`size-4 ${active(it.href) ? "text-ink" : "text-muted"}`} />
                  <span className="flex-1">{it.label}</span>
                  {it.badge ? <span className={`min-w-5 text-center rounded-full px-1.5 text-[11px] font-medium tabular ${it.tone === "bad" ? "bg-bad-soft text-bad" : "bg-line-2 text-ink-2"}`}>{it.badge}</span> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <Link href="/settings" className={`flex items-center gap-2.5 mx-3 mb-3 rounded-md px-2 py-2 text-[13px] ${active("/settings") ? "bg-hover" : "hover:bg-hover"}`}>
          <Icon name="settings" className="size-4 text-muted" />
          <span className="flex-1 min-w-0">
            <span className="block text-ink-2">Settings</span>
            <span className="block text-[11px] text-faint truncate">{counts.profileLabel}</span>
          </span>
        </Link>
      </aside>

      {/* mobile */}
      <header className="no-print md:hidden sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line">
        <div className="flex items-center gap-2 px-4 h-12">
          <span className="grid place-items-center size-6 rounded bg-brand text-white font-[family-name:var(--font-seal)] text-xs">印</span>
          <span className="font-semibold text-sm">Memini</span>
          <Link href="/upload" className="ml-auto text-xs rounded-md bg-ink text-white px-2.5 py-1">Add</Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-[13px]">
          {[...groups.flatMap((g) => g.items), { href: "/settings", label: "Settings", icon: "settings" }].map((it) => (
            <Link key={it.href} href={it.href} className={`whitespace-nowrap rounded-md px-2.5 py-1 ${active(it.href) ? "bg-hover font-medium" : "text-muted"}`}>
              {it.label}{"badge" in it && it.badge ? ` · ${it.badge}` : ""}
            </Link>
          ))}
        </nav>
      </header>
    </>
  );
}
