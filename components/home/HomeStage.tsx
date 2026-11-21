"use client";
// Today's stage. Before you say anything: a greeting, the floating composer, and the Bento of what needs you below.
// Once you start talking, the conversation takes the wide column and the Bento folds into a rail beside it,
// so nothing is wiped and everything stays one glance away. "Today" tucks the conversation away without losing it.
import type { ReactNode } from "react";
import { Composer } from "../chat/Composer";
import { Thread } from "../chat/Thread";
import { useChat } from "../chat/ChatProvider";
import { suggestionsFor, type SuggestionScope } from "../chat/suggestions";

export function HomeStage({ eyebrow, lead, rest, business, children }: { eyebrow: ReactNode; lead: string; rest: string; business: SuggestionScope; children: ReactNode }) {
  const { turns, busy, send, newChat, minimized, setMinimized } = useChat();
  const chatting = turns.length > 0 && !minimized;
  const last = turns.filter((t) => t.role === "user").slice(-1)[0];

  if (!chatting) {
    return (
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8 pt-32 sm:pt-44 pb-40">
        <section className="max-w-[860px]">
          <div className="enter text-[13px] font-medium text-muted mb-6 flex flex-wrap items-center gap-x-2.5 gap-y-1">{eyebrow}</div>
          <h1 className="enter display text-[46px] sm:text-[84px] leading-[1.0] tracking-[-0.02em] text-pretty">
            <span className="text-ink">{lead}</span> <span className="text-stone">{rest}</span>
          </h1>
          <div className="enter-2 mt-10 sm:mt-12 max-w-[760px]"><Composer variant="hero" /></div>
          <div className="enter-3 flex flex-wrap items-center gap-2 mt-5 max-w-[760px]">
            {suggestionsFor(business).map((s) => (
              <button key={s} disabled={busy} onClick={() => void send(s)} className="press rounded-full border border-line bg-card/70 px-3.5 h-9 text-[13.5px] text-ink-2 hover:bg-card hover:text-ink hover:border-ink/25">{s}</button>
            ))}
          </div>
          {turns.length > 0 && (
            <button onClick={() => setMinimized(false)} className="bracket mt-5">
              Resume conversation{last && last.role === "user" && last.text ? `: “${last.text.slice(0, 40)}${last.text.length > 40 ? "…" : ""}”` : ""}
            </button>
          )}
        </section>
        <div className="enter-4 mt-16 sm:mt-24">{children}</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-4 sm:px-8 pt-24 sm:pt-28">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-x-12">
        <section className="min-w-0 flex flex-col min-h-[calc(100vh-8rem)] enter">
          <div className="flex items-center justify-between h-12 mb-6 max-w-[740px] w-full mx-auto lg:mx-0">
            <span className="text-[13px] font-medium text-faint">Conversation</span>
            <div className="flex items-center gap-3">
              <button onClick={() => setMinimized(true)} className="bracket">Today</button>
              <button onClick={newChat} className="bracket">New</button>
            </div>
          </div>
          <Thread className="flex-1 max-w-[740px] w-full mx-auto lg:mx-0 pb-10" />
          <div className="sticky bottom-24 md:bottom-5 z-20 pt-4 pb-1 max-w-[740px] w-full mx-auto lg:mx-0">
            <Composer variant="hero" />
          </div>
        </section>
        <aside className="hidden lg:block pb-10">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto overscroll-contain pr-1 pb-6 -mr-1">
            <div className="text-[13px] font-medium text-faint h-12 mb-6 flex items-center">Today</div>
            {children}
          </div>
        </aside>
      </div>
    </div>
  );
}
