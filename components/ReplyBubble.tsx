"use client";
// Renders an OutgoingReply the way the chat shows Memini's answers: text, then its menu buttons.
import type { OutgoingReply } from "@/lib/core/reply";
import { Mark } from "./Mark";
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

/** A document Memini made (the verification sheet): a download card. The link is made relative so it works on any host. */
export function FileCard({ file, className = "" }: { file: { name: string; url: string }; className?: string }) {
  let href = file.url;
  try { href = new URL(file.url).pathname; } catch { /* already relative */ }
  return (
    <a href={href} download={file.name} className={`${className} press group flex items-center gap-3.5 rounded-3xl border border-line bg-card px-4 py-3.5 hover:border-ink/25 max-w-[440px]`}>
      <span className="grid place-items-center size-11 rounded-2xl bg-ok-soft text-ok shrink-0 text-[11px] font-bold tracking-wide">XLSX</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink truncate">{file.name}</span>
        <span className="block text-[12.5px] text-muted">Verification sheet · 核对表 — download</span>
      </span>
    </a>
  );
}

/** A Chinese text meant to be sent as it is: its own green card with one-tap Copy. */
export function ChineseCard({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`${className} rounded-3xl border border-wechat/25 bg-wechat-soft px-5 py-4`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[12px] font-medium text-wechat-dark">中文 · ready to send on WeChat</span>
        <CopyButton text={text} label="Copy" className="press rounded-full bg-wechat-dark text-white px-3.5 h-8 text-[12.5px] font-medium hover:bg-[#046e36]" />
      </div>
      <div lang="zh-CN" className="text-[15px] leading-[1.75] whitespace-pre-wrap break-all text-ink">{text}</div>
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
        {reply.file ? <FileCard file={reply.file} /> : text && <div className="text-[14.5px] leading-[1.65] whitespace-pre-wrap break-words text-ink">{linkify(text)}</div>}
        {zh && <ChineseCard text={zh} className={text ? "mt-3" : ""} />}
        {buttons?.length ? (
          <div className="flex flex-wrap gap-2 mt-3">
            {buttons.map((b) => (
              <button key={b.id} disabled={disabled || !onButton} onClick={() => onButton?.(b.id, b.label)}
                className="press rounded-full border border-line bg-card/80 px-3.5 h-9 text-[13px] text-ink hover:bg-card hover:border-ink/25 disabled:opacity-60">
                {b.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
