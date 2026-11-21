"use client";
// Renders an OutgoingReply the way the Home chat shows Memini's answers: text, then its menu buttons.
import type { OutgoingReply } from "@/lib/core/reply";
import { Mark } from "./Sidebar";

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 decoration-line hover:decoration-ink">Open details</a>
    ) : <span key={i}>{p}</span>,
  );
}

export function ReplyBubble({ reply, onButton, disabled }: { reply: OutgoingReply; onButton?: (id: string, label: string) => void; disabled?: boolean }) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0"><Mark size="sm" /></div>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] leading-[1.65] whitespace-pre-wrap break-words">{linkify(reply.text)}</div>
        {reply.buttons?.length ? (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {reply.buttons.map((b) => (
              <button key={b.id} disabled={disabled || !onButton} onClick={() => onButton?.(b.id, b.label)}
                className="press rounded-full border border-line bg-card px-3 h-8 text-[13px] hover:bg-hover disabled:opacity-60">
                {b.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
