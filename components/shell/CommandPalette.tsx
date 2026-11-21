"use client";
// ⌘K: jump to any contact, matter or document, go to a place, or hand the question to Memini.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, MATTER_ICON } from "../Icon";
import { useChat } from "../chat/ChatProvider";
import type { IndexItem } from "./data";

type Entry = { id: string; label: string; sub?: string; icon: string; group: string; run: () => void };

export function CommandPalette({ open, onClose, index, business }: { open: boolean; onClose: () => void; index: IndexItem[]; business: boolean }) {
  const router = useRouter();
  const { send, setPanel, requestFocus, setMinimized } = useChat();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 30); } }, [open]);

  const go = (href: string) => () => { onClose(); router.push(href); };
  const places: Entry[] = useMemo(() => [
    { id: "p-today", label: "Today", icon: "home", group: "Go to", run: go("/") },
    { id: "p-work", label: business ? "Matters" : "Purchases", sub: "Work", icon: "folder", group: "Go to", run: go("/matters") },
    { id: "p-quotes", label: "Compare quotes", sub: "Work", icon: "scale", group: "Go to", run: go("/compare") },
    { id: "p-out", label: "RFQ outreach", sub: "Work", icon: "send", group: "Go to", run: go("/outreach") },
    { id: "p-contacts", label: business ? "Contacts" : "Suppliers", sub: "Memory", icon: "users", group: "Go to", run: go("/contacts") },
    { id: "p-docs", label: "Documents", sub: "Memory", icon: "file", group: "Go to", run: go("/documents") },
    { id: "p-dl", label: "Deadlines and calendar", sub: "Memory", icon: "calendar", group: "Go to", run: go("/deadlines") },
    { id: "p-inbox", label: "To file", icon: "inbox", group: "Go to", run: go("/inbox") },
    { id: "p-wechat", label: "WeChat bot", icon: "wechat", group: "Go to", run: go("/wechat") },
    { id: "p-set", label: "Settings", icon: "settings", group: "Go to", run: go("/settings") },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [business]);

  const entries = useMemo<Entry[]>(() => {
    const s = q.trim().toLowerCase();
    const hits = (text: string) => !s || text.toLowerCase().includes(s);
    const found: Entry[] = index
      .filter((i) => hits(`${i.label} ${i.sub}`))
      .slice(0, s ? 12 : 6)
      .map((i, n) => ({
        id: `i-${n}-${i.href}`, label: i.label, sub: i.sub, group: i.kind === "contact" ? "Contacts" : i.kind === "matter" ? "Matters" : "Documents",
        icon: i.kind === "contact" ? "user" : i.kind === "matter" ? MATTER_ICON.general : "file", run: go(i.href),
      }));
    const nav = places.filter((p) => hits(`${p.label} ${p.sub ?? ""}`));
    const ask: Entry[] = s ? [{
      id: "ask", label: `Ask Memini: “${q.trim()}”`, icon: "chat", group: "Ask",
      run: () => { onClose(); setMinimized(false); void send(q.trim()); },
    }] : [{
      id: "ask-open", label: "Ask Memini something", icon: "chat", group: "Ask",
      run: () => { onClose(); if (location.pathname === "/") requestFocus(); else setPanel(true); },
    }];
    return s ? [...nav, ...found, ...ask] : [...ask, ...nav.slice(0, 6), ...found];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, index, places]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open) return null;
  const groups: { name: string; items: { e: Entry; i: number }[] }[] = [];
  entries.forEach((e, i) => { const g = groups.find((x) => x.name === e.group) ?? (groups[groups.push({ name: e.group, items: [] }) - 1]); g.items.push({ e, i }); });

  return (
    <div className="no-print fixed inset-0 z-[80] grid place-items-start justify-items-center pt-[12vh] px-4" role="dialog" aria-modal="true" aria-label="Search and jump">
      <button aria-label="Close search" onClick={onClose} className="absolute inset-0 bg-ink/25 backdrop-blur-[3px] fade-in cursor-default" />
      <div className="relative w-full max-w-[600px] rounded-[28px] bg-card border border-line shadow-[0_40px_80px_-30px_rgb(22_21_19/0.45)] overflow-hidden rise"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(entries.length - 1, s + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
          else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); entries[sel]?.run(); }
        }}>
        <div className="flex items-center gap-3 px-5 h-16 border-b border-line">
          <Icon name="search" className="size-5 text-faint shrink-0" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a contact, matter or document, or ask…" aria-label="Search"
            className="flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
          <kbd className="mono text-[11px] text-faint border border-line rounded-md px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={list} className="max-h-[52vh] overflow-y-auto p-2">
          {groups.map((g) => (
            <div key={g.name} className="mb-1">
              <div className="px-3 pt-2.5 pb-1 text-[11.5px] font-medium text-faint">{g.name}</div>
              {g.items.map(({ e, i }) => (
                <button key={e.id} data-i={i} onClick={e.run} onMouseMove={() => setSel(i)}
                  className={`w-full flex items-center gap-3 rounded-2xl px-3 h-12 text-left transition-colors ${sel === i ? "bg-hover" : ""}`}>
                  <span className="grid place-items-center size-8 rounded-xl bg-line-2 text-ink-2 shrink-0"><Icon name={e.icon} className="size-4" /></span>
                  <span className="flex-1 min-w-0 truncate text-[14.5px]">{e.label}</span>
                  {e.sub && <span className="text-[12.5px] text-faint truncate max-w-[40%]">{e.sub}</span>}
                  {sel === i && <Icon name="arrow" className="size-3.5 text-faint shrink-0" />}
                </button>
              ))}
            </div>
          ))}
          {!entries.length && <div className="px-4 py-10 text-center text-[14px] text-muted">Nothing matches.</div>}
        </div>
      </div>
    </div>
  );
}
