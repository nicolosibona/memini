"use client";
// Renders an OutgoingReply the way the Home chat shows Memini's answers: text, then its menu buttons.
import type { OutgoingReply } from "@/lib/core/reply";
import { Mark } from "./Sidebar";
import { CopyButton } from "./CopyButton";

/** The Chinese draft gets its own card on the web, so it is taken out of the running text. */
export function withoutDraft(text: string, zh: string) {
  if (text === zh) return "";
  return text.replace(zh, "").replace(/💬 Suggested reply \(copy and send\):\s*$/m, "").replace(/\n{3,}/g, "\n\n").trim();
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((p, i) =>
    /^https?:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2 decoration-line hover:decoration-ink">Open details</a>
    ) : <span key={i}>{p}</span>,
  );
}

/** A Chinese text meant to be sent as it is: its own green card with one-tap Copy. */
export function ChineseCard({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`${className} rounded-2xl border border-wechat/30 bg-wechat-soft px-4 py-3`}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[12px] font-medium text-wechat-dark">中文 · ready to send on WeChat</span>
        <CopyButton text={text} label="Copy" className="press rounded-full bg-wechat text-white px-3 h-7 text-[12.5px] font-medium hover:bg-wechat-dark" />
      </div>
      <div lang="zh-CN" className="text-[15px] leading-[1.75] whitespace-pre-wrap break-all">{text}</div>
    </div>
  );
}

export function ReplyBubble({ reply, onButton, disabled }: { reply: OutgoingReply; onButton?: (id: string, label: string) => void; disabled?: boolean }) {
  const zh = reply.copy?.text;
  const text = zh ? withoutDraft(reply.text, zh) : reply.text;
  const buttons = reply.buttons?.filter((b) => !b.id.startsWith("zh:")); // the web has its own Copy button
  return (
    <div className="flex gap-3">
      <div className="shrink-0"><Mark size="sm" /></div>
      <div className="min-w-0 flex-1">
        {text && <div className="text-[14.5px] leading-[1.65] whitespace-pre-wrap break-words">{linkify(text)}</div>}
        {zh && <ChineseCard text={zh} className={text ? "mt-3" : ""} />}
        {buttons?.length ? (
          <div className="flex flex-wrap gap-2 mt-2.5">
            {buttons.map((b) => (
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
