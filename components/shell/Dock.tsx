"use client";
// Anywhere but Home: the ask dock (a floating pill at the bottom) and the conversation slide-over it opens.
// The conversation is the same one as on Home, so nothing is lost by moving around.
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "../Icon";
import { Mark } from "../Mark";
import { Composer } from "../chat/Composer";
import { Thread } from "../chat/Thread";
import { useChat } from "../chat/ChatProvider";
import { suggestionsFor, type SuggestionScope } from "../chat/suggestions";

export function Dock({ onSearch }: { onSearch: () => void }) {
  const path = usePathname();
  const { setPanel, turns, panel } = useChat();
  if (path === "/" || panel) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-x-0 bottom-5 z-40 hidden md:flex justify-center px-4">
      <div className="frost pointer-events-auto rounded-full h-14 w-[min(560px,100%)] pl-2 pr-2.5 flex items-center gap-2">
        <button onClick={() => setPanel(true)} className="press flex-1 min-w-0 h-10 rounded-full flex items-center gap-3 pl-1.5 pr-3 text-left text-[14.5px] text-muted hover:text-ink">
          <Mark size="sm" />
          <span className="truncate">{turns.length ? "Continue the conversation…" : "Ask anything, paste a chat, or drop a file…"}</span>
        </button>
        <button onClick={onSearch} className="press hidden lg:inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12.5px] text-faint hover:text-ink hover:bg-ink/5" aria-label="Search and jump">
          <Icon name="search" className="size-4" /><kbd className="mono">⌘K</kbd>
        </button>
      </div>
    </div>
  );
}

export function ChatPanel({ business }: { business: SuggestionScope }) {
  const { panel, setPanel, turns, newChat, send, busy } = useChat();
  useEffect(() => {
    if (!panel) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setPanel(false);
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [panel, setPanel]);
  if (!panel) return null;
  return (
    <div className="no-print fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Conversation with Memini">
      <button aria-label="Close conversation" onClick={() => setPanel(false)} className="absolute inset-0 bg-ink/20 backdrop-blur-[2px] fade-in cursor-default" />
      <aside className="drawer-in absolute right-0 top-0 bottom-0 w-full sm:w-[520px] bg-paper border-l border-line shadow-[-30px_0_60px_-40px_rgb(22_21_19/0.35)] flex flex-col">
        <div className="flex items-center justify-between gap-3 h-16 px-5 border-b border-line shrink-0">
          <div className="flex items-center gap-2.5"><Mark size="sm" /><span className="text-[15px] font-medium">Conversation</span></div>
          <div className="flex items-center gap-1">
            {turns.length > 0 && <button onClick={newChat} className="bracket">New</button>}
            <button onClick={() => setPanel(false)} aria-label="Close" className="press grid place-items-center size-10 rounded-full hover:bg-ink/5"><Icon name="x" className="size-5" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-7">
          {turns.length ? <Thread /> : (
            <div className="pt-6">
              <h2 className="display text-[34px] leading-[1.08]">Ask anything. <span className="text-stone">I answer from what you&apos;ve forwarded.</span></h2>
              <div className="flex flex-wrap gap-2 mt-6">
                {suggestionsFor(business).map((s) => (
                  <button key={s} disabled={busy} onClick={() => void send(s)} className="press rounded-full border border-line bg-card px-3.5 h-9 text-[13.5px] text-ink-2 hover:text-ink hover:border-ink/25">{s}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="shrink-0 px-4 pb-4 pt-2 bg-gradient-to-t from-paper via-paper to-paper/0">
          <Composer variant="panel" autoFocus />
          <p className="text-[12px] text-faint text-center mt-2">Same assistant as on WeChat</p>
        </div>
      </aside>
    </div>
  );
}
