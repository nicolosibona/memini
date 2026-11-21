"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Item = { href: string; label: string; icon: string; badge?: number; tone?: "bad" | "neutral" };
export type NavCounts = { inbox: number; overdue: number; alerts: number; compare: boolean; profileLabel: string; business: boolean; wechat: "off" | "ready" | "linked" };

export function Mark({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className={`grid place-items-center rounded-[9px] bg-brand text-white font-[family-name:var(--font-seal)] leading-none ${size === "md" ? "size-8 text-[17px]" : "size-7 text-[15px]"}`}>印</span>
  );
}

export function Sidebar({ counts }: { counts: NavCounts }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  if (path.startsWith("/s/")) return null; // the mobile page opened from WeChat has no app chrome

  const main: Item[] = [
    { href: "/", label: "Home", icon: "home", badge: counts.alerts || undefined, tone: "bad" },
    { href: "/inbox", label: "To file", icon: "inbox", badge: counts.inbox || undefined },
  ];
  const work: Item[] = [
    { href: "/matters", label: counts.business ? "Matters" : "Purchases", icon: "folder" },
    { href: "/deadlines", label: "Deadlines", icon: "calendar", badge: counts.overdue || undefined, tone: "bad" },
    ...(counts.compare ? [{ href: "/compare", label: "Compare quotes", icon: "scale" }] : []),
    { href: "/contacts", label: counts.business ? "Contacts" : "Suppliers", icon: "users" },
    { href: "/documents", label: "Documents", icon: "file" },
  ];
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  const wechatLabel = counts.wechat === "linked" ? "Connected" : counts.wechat === "ready" ? "Ready to connect" : "Not set up";

  const link = (it: Item) => (
    <Link key={it.href} href={it.href} aria-current={active(it.href) ? "page" : undefined}
      className={`press group flex items-center gap-3 rounded-xl px-3 h-10 text-[14px] transition-colors ${active(it.href) ? "bg-card text-ink font-medium shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:bg-hover"}`}>
      <Icon name={it.icon} className={`size-[18px] ${active(it.href) ? "text-brand" : "text-muted group-hover:text-ink-2"}`} />
      <span className="flex-1">{it.label}</span>
      {it.badge ? <span className={`min-w-5 h-5 grid place-items-center rounded-full px-1.5 text-[11.5px] font-semibold tabular ${it.tone === "bad" ? "bg-bad text-white" : "bg-ink text-white"}`}>{it.badge}</span> : null}
    </Link>
  );

  const nav = (
    <>
      <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {main.map(link)}
        <div className="h-4" />
        {work.map(link)}
      </nav>
      <div className="px-3 pb-4 space-y-1">
        <Link href="/wechat" className={`press flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${active("/wechat") ? "bg-card shadow-[0_0_0_1px_var(--color-line)]" : "hover:bg-hover"}`}>
          <span className="relative grid place-items-center size-8 rounded-full bg-wechat-soft text-wechat-dark">
            <Icon name="wechat" className="size-[17px]" />
            <span className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-paper ${counts.wechat === "linked" ? "bg-wechat live-dot" : counts.wechat === "ready" ? "bg-warn" : "bg-faint"}`} />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[14px] font-medium text-ink">WeChat bot</span>
            <span className="block text-[12.5px] text-muted">{wechatLabel}</span>
          </span>
        </Link>
        <Link href="/settings" className={`press flex items-center gap-3 rounded-xl px-3 h-10 text-[14px] transition-colors ${active("/settings") ? "bg-card text-ink font-medium shadow-[0_0_0_1px_var(--color-line)]" : "text-ink-2 hover:bg-hover"}`}>
          <Icon name="settings" className="size-[18px] text-muted" />
          <span className="flex-1">Settings</span>
          <span className="text-[12px] text-faint truncate max-w-24">{counts.profileLabel}</span>
        </Link>
      </div>
    </>
  );

  return (
    <>
      {/* desktop */}
      <aside className="no-print hidden md:flex w-[248px] shrink-0 flex-col h-screen sticky top-0 border-r border-line">
        <Link href="/" className="flex items-center gap-2.5 px-5 h-16">
          <Mark />
          <span className="display text-[24px] leading-none">Memini</span>
        </Link>
        {nav}
      </aside>

      {/* mobile */}
      <header className="no-print md:hidden sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line">
        <div className="flex items-center gap-2.5 px-4 h-14">
          <Link href="/" className="flex items-center gap-2.5"><Mark size="sm" /><span className="display text-[22px] leading-none">Memini</span></Link>
          <span className="flex-1" />
          {counts.alerts > 0 && <span className="h-6 grid place-items-center rounded-full bg-bad text-white text-[12px] font-semibold px-2">{counts.alerts}</span>}
          <button onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Close menu" : "Open menu"} className="press grid place-items-center size-11 rounded-full hover:bg-hover">
            <Icon name={open ? "x" : "menu"} className="size-5" />
          </button>
        </div>
        {open && <div className="fixed inset-x-0 top-14 bottom-0 bg-paper flex flex-col rise">{nav}</div>}
      </header>
    </>
  );
}
