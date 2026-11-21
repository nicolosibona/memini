"use client";
// The conversation itself: Memini's answers (text, copy-ready Chinese, menu buttons) and what you sent.
import { useEffect, useRef } from "react";
import { Icon } from "../Icon";
import { Mark } from "../Mark";
import { ChineseCard, FileCard, withoutDraft } from "../ReplyBubble";
import { useChat, type Turn } from "./ChatProvider";

function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((p, i) => {
        if (!/^https?:\/\//.test(p)) return <span key={i}>{p}</span>;
        let href = p;
        try { const u = new URL(p); if (u.pathname.startsWith("/s/") || u.host === window.location.host) href = u.pathname + u.search; } catch { /* keep */ }
        return (
          <a key={i} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-line-2 px-2.5 py-0.5 text-[13px] font-medium text-ink hover:bg-line align-baseline">
            Open details <Icon name="arrow" className="size-3" />
          </a>
        );
      })}
    </>
  );
}

function BotTurn({ turn, busy, onButton }: { turn: Extract<Turn, { role: "bot" }>; busy: boolean; onButton: (id: string, label: string) => void }) {
  return (
    <div className="flex gap-3.5 rise">
      <div className="pt-0.5 shrink-0"><Mark size="sm" /></div>
      <div className="min-w-0 flex-1 space-y-3">
        {turn.replies.map((r, i) => {
          const zh = r.copy?.text;
          const text = zh ? withoutDraft(r.text, zh) : r.text;
          const buttons = r.buttons?.filter((b) => !b.id.startsWith("zh:")); // the card below has its own Copy
          return (
            <div key={i}>
              {r.file ? <FileCard file={r.file} /> : text && <div className="text-[15.5px] leading-[1.7] text-ink whitespace-pre-wrap break-words"><Linkified text={text} /></div>}
              {zh && <ChineseCard text={zh} className={text ? "mt-3" : ""} />}
              {buttons?.length ? (
                <div className="flex flex-wrap gap-2 mt-3">
                  {buttons.map((b) => (
                    <button key={b.id} disabled={busy} onClick={() => onButton(b.id, b.label)}
                      className="press rounded-full border border-line bg-card px-3.5 h-9 text-[13.5px] text-ink hover:border-ink/30 hover:bg-hover disabled:opacity-50">
                      {b.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {!turn.replies.length && <div className="text-[15px] text-muted">Got it.</div>}
        {turn.ms != null && <div className="text-[12px] text-faint tabular">{(turn.ms / 1000).toFixed(1)} s</div>}
      </div>
    </div>
  );
}

export function Thread({ className = "" }: { className?: string }) {
  const { turns, busy, tap } = useChat();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);
  const last = turns[turns.length - 1];
  return (
    <div className={`space-y-9 ${className}`}>
      {turns.map((t, i) =>
        t.role === "user" ? (
          <div key={i} className="flex justify-end rise">
            <div className="max-w-[85%] space-y-2 flex flex-col items-end">
              {t.files?.map((f) => <span key={f} className="inline-flex items-center gap-2 rounded-2xl border border-line bg-card px-3.5 py-2 text-[14px]"><Icon name="file" className="size-4 text-muted" />{f}</span>)}
              {t.text && <div className="rounded-[22px] rounded-br-md bg-ink text-white px-4 py-2.5 text-[15.5px] leading-[1.6] whitespace-pre-wrap break-words">{t.text}</div>}
            </div>
          </div>
        ) : t.role === "bot" ? (
          <BotTurn key={i} turn={t} busy={busy} onButton={tap} />
        ) : (
          <div key={i} className="flex gap-2 text-[14px] text-bad rise"><Icon name="alert" className="size-4 mt-0.5" />{t.text}</div>
        ),
      )}
      {busy && (
        <div className={`flex gap-3.5 items-center ${last?.role === "bot" ? "pl-[42px] -mt-6" : ""}`}>
          {last?.role !== "bot" && <Mark size="sm" />}
          <span className="typing text-[22px] leading-none text-muted tracking-widest" role="status" aria-label="Memini is working"><span>·</span><span>·</span><span>·</span></span>
        </div>
      )}
      <div ref={end} className="scroll-mb-44" />
    </div>
  );
}
