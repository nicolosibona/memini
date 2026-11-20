"use client";
// Renders an OutgoingReply as WeChat shows it: a text bubble with msgmenu buttons below; links clickable.
import type { OutgoingReply } from "@/lib/core/reply";

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="text-[#576b95] break-all">{p.replace(/^https?:\/\/[^/]+/, "").slice(0, 24)}…</a>
    ) : <span key={i}>{p}</span>,
  );
}

export function ReplyBubble({ reply, onButton, disabled }: { reply: OutgoingReply; onButton?: (id: string, label: string) => void; disabled?: boolean }) {
  return (
    <div className="max-w-[86%] rounded-md bg-white px-3 py-2 text-[14px] leading-[1.55] text-[#191919] shadow-[0_0_0_1px_rgba(0,0,0,0.04)]">
      <div className="whitespace-pre-wrap break-words">{linkify(reply.text)}</div>
      {reply.buttons?.length ? (
        <div className="mt-2 -mx-3 border-t border-black/[0.06] flex flex-col">
          {reply.buttons.map((b) => (
            <button key={b.id} disabled={disabled || !onButton} onClick={() => onButton?.(b.id, b.label)}
              className="text-left px-3 py-2 text-[#576b95] border-b border-black/[0.04] last:border-b-0 hover:bg-black/[0.02] disabled:opacity-60">
              {b.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
