"use client";
// Floating chrome: a wordmark island, the four places you go (Today · Work · Memory · To file), and a status island
// (search, WeChat, settings). On phones the places become a floating tab island at the bottom with Ask in the middle.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "../Icon";
import { Mark } from "../Mark";
import { useChat } from "../chat/ChatProvider";
import type { NavCounts } from "./data";

export type PlaceKey = "today" | "work" | "memory" | "file";
const PLACES: { key: PlaceKey; href: string; label: string; icon: string; match: (p: string) => boolean }[] = [
  { key: "today", href: "/", label: "Today", icon: "home", match: (p) => p === "/" },
  { key: "work", href: "/matters", label: "Work", icon: "layers", match: (p) => ["/matters", "/compare", "/outreach"].some((x) => p === x || p.startsWith(x + "/")) },
  { key: "memory", href: "/contacts", label: "Memory", icon: "users", match: (p) => ["/contacts", "/documents", "/deadlines"].some((x) => p === x || p.startsWith(x + "/")) },
  { key: "file", href: "/inbox", label: "To file", icon: "inbox", match: (p) => p === "/inbox" },
];

/** Electronics workspaces: "Spec checks" takes the place of Work. */
const placesFor = (c: NavCounts) => c.electronics
  ? PLACES.map((p) => p.key === "work" ? { ...p, href: "/specs", label: "Spec checks", icon: "scale", match: (x: string) => x === "/specs" || x.startsWith("/specs/") } : p)
  : PLACES;

const badge = (c: NavCounts, k: PlaceKey): { n: number; tone: "bad" | "ink" } | null =>
  k === "today" ? (c.alerts ? { n: c.alerts, tone: "bad" } : null)
  : k === "memory" ? (c.overdue ? { n: c.overdue, tone: "bad" } : null)
  : k === "file" ? (c.inbox ? { n: c.inbox, tone: "ink" } : null)
  : null;

function Badge({ n, tone, onDark = false }: { n: number; tone: "bad" | "ink"; onDark?: boolean }) {
  const cls = tone === "bad" ? "bg-bad text-white" : onDark ? "bg-white text-ink" : "bg-ink text-white";
  return <span className={`min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[11px] font-semibold tabular leading-none ${cls}`}>{n}</span>;
}

export function TopNav({ counts, onSearch }: { counts: NavCounts; onSearch: () => void }) {
  const path = usePathname();
  const wechat = counts.wechat === "linked"
    ? { label: "WeChat live", dot: "bg-wechat live-dot", text: "text-wechat-dark" }
    : counts.wechat === "ready" ? { label: "Connect WeChat", dot: "bg-warn", text: "text-ink-2" } : { label: "WeChat off", dot: "bg-faint", text: "text-muted" };
  const active = (p: string) => path === p || path.startsWith(p + "/");

  return (
    <header className="no-print fixed inset-x-0 top-0 z-50 pointer-events-none">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8 pt-3 sm:pt-4 flex items-center justify-between gap-3">
        <Link href="/" aria-label="Memini, Today" className="frost pointer-events-auto rounded-full h-12 pl-2 pr-5 flex items-center gap-2.5 press">
          <Mark size="sm" />
          <span className="display text-[23px] leading-none -mb-0.5">Memini</span>
        </Link>

        <nav aria-label="Primary" className="frost pointer-events-auto hidden md:flex items-center gap-0.5 rounded-full h-12 p-1.5">
          {placesFor(counts).map((p) => {
            const on = p.match(path);
            const b = badge(counts, p.key);
            return (
              <Link key={p.key} href={p.href} aria-current={on ? "page" : undefined}
                className={`press inline-flex items-center gap-2 h-9 px-4 rounded-full text-[14px] font-medium transition-colors ${on ? "bg-ink text-white" : "text-ink-2 hover:bg-ink/5"}`}>
                {p.label}
                {b && <Badge n={b.n} tone={b.tone} onDark={on} />}
              </Link>
            );
          })}
        </nav>

        <div className="frost pointer-events-auto flex items-center gap-0.5 rounded-full h-12 p-1.5">
          <button onClick={onSearch} aria-label="Search and jump (⌘K)" title="Search and jump (⌘K)"
            className="press inline-flex items-center gap-2 h-9 px-3 rounded-full text-muted hover:text-ink hover:bg-ink/5">
            <Icon name="search" className="size-[18px]" />
            <kbd className="hidden lg:inline mono text-[11px] text-faint border border-line rounded-md px-1.5 py-0.5 bg-white/60">⌘K</kbd>
          </button>
          <Link href="/wechat" aria-current={active("/wechat") ? "page" : undefined} title={wechat.label}
            className={`press inline-flex items-center gap-2 h-9 px-3 rounded-full text-[13px] font-medium hover:bg-ink/5 ${active("/wechat") ? "bg-ink/5" : ""} ${wechat.text}`}>
            <span className={`size-2 rounded-full ${wechat.dot}`} />
            <span className="hidden lg:inline">{wechat.label}</span>
            <span className="sr-only lg:hidden">{wechat.label}</span>
          </Link>
          <Link href="/settings" aria-label="Settings" aria-current={active("/settings") ? "page" : undefined} title="Settings"
            className={`press grid place-items-center size-9 rounded-full text-muted hover:text-ink hover:bg-ink/5 ${active("/settings") ? "bg-ink/5 text-ink" : ""}`}>
            <Icon name="settings" className="size-[18px]" />
          </Link>
        </div>
      </div>
    </header>
  );
}

/** Phones: tab island at the bottom, Ask in the middle. */
export function TabBar({ counts }: { counts: NavCounts }) {
  const path = usePathname();
  const { setPanel, requestFocus } = useChat();
  const ask = () => { if (path === "/") { window.scrollTo({ top: 0, behavior: "smooth" }); requestFocus(); } else setPanel(true); };
  const item = (k: PlaceKey) => {
    const p = placesFor(counts).find((x) => x.key === k)!;
    const on = p.match(path);
    const b = badge(counts, k);
    return (
      <Link key={k} href={p.href} aria-current={on ? "page" : undefined} className={`press relative flex flex-col items-center justify-center gap-0.5 h-full flex-1 rounded-2xl text-[11px] font-medium ${on ? "text-ink" : "text-muted"}`}>
        <span className={`grid place-items-center h-7 w-12 rounded-full transition-colors ${on ? "bg-ink text-white" : ""}`}><Icon name={p.icon} className="size-[19px]" /></span>
        {p.label}
        {b && <span className="absolute top-1 right-[18%]"><Badge n={b.n} tone={b.tone} /></span>}
      </Link>
    );
  };
  return (
    <nav aria-label="Primary" className="no-print md:hidden fixed inset-x-3 bottom-3 z-50 pb-[env(safe-area-inset-bottom)]">
      <div className="frost rounded-[28px] h-[68px] px-1.5 flex items-center !bg-white/90">
        {item("today")}{item("work")}
        <button onClick={ask} aria-label="Ask Memini" className="press shrink-0 mx-1 grid place-items-center size-12 rounded-full bg-ink text-white shadow-[0_8px_20px_-8px_rgb(22_21_19/0.6)]"><Icon name="chat" className="size-5" /></button>
        {item("memory")}{item("file")}
      </div>
    </nav>
  );
}
