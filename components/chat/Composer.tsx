"use client";
// The message box. "hero" is the big floating frosted pill on Home; "panel" sits at the bottom of the slide-over.
// Same behaviour in both: Enter sends, Shift+Enter is a new line, files attach by clip or drop, IME-safe.
import { useEffect, useRef } from "react";
import { Icon } from "../Icon";
import { useChat, MAX_MB } from "./ChatProvider";

const emit = (on: boolean) => window.dispatchEvent(new CustomEvent("memini:focus", { detail: { on } }));

export function Composer({ variant = "hero", prompt = "Ask anything, paste a chat, or drop a document…", autoFocus = false }: { variant?: "hero" | "panel"; prompt?: string; autoFocus?: boolean }) {
  const { text, setText, files, removeFile, addFiles, busy, send, hint, focusTick } = useChat();
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => { const a = area.current; if (a) { a.style.height = "0px"; a.style.height = `${Math.min(a.scrollHeight, 220)}px`; } }, [text]);
  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (focusTick) area.current?.focus(); }, [focusTick]);
  useEffect(() => () => { emit(false); }, []);

  const hero = variant === "hero";
  return (
    <div>
      <div className={`${hero ? "frost rounded-[30px] focus-within:shadow-[var(--shadow-float),0_0_0_4px_rgb(255_255_255/0.6)]" : "rounded-[26px] border border-line bg-card shadow-bento focus-within:border-ink/30"} transition-shadow`}>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3.5">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-full bg-line-2 pl-3 pr-1.5 h-8 text-[13px] max-w-full">
                <Icon name={f.type.startsWith("image/") ? "image" : "file"} className="size-3.5 text-muted shrink-0" />
                <span className="truncate max-w-52">{f.name}</span>
                <button onClick={() => removeFile(i)} aria-label={`Remove ${f.name}`} className="grid place-items-center size-6 rounded-full hover:bg-line text-muted"><Icon name="x" className="size-3" /></button>
              </span>
            ))}
          </div>
        )}
        <div className={`flex items-end gap-1.5 ${hero ? "p-2.5 pl-3.5" : "p-2 pl-2.5"}`}>
          <button type="button" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach documents or photos"
            className="press grid place-items-center size-11 rounded-full text-muted hover:text-ink hover:bg-ink/5 shrink-0">
            <Icon name="clip" className="size-5" />
          </button>
          <textarea ref={area} value={text} rows={1} onChange={(e) => setText(e.target.value)}
            onFocus={() => emit(true)} onBlur={() => emit(false)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder={prompt} aria-label="Message Memini"
            className={`flex-1 resize-none bg-transparent py-3 leading-6 placeholder:text-faint outline-none focus-visible:outline-none min-h-12 ${hero ? "text-[16.5px]" : "text-[15.5px]"}`} />
          <button type="button" onClick={() => void send()} disabled={busy || (!text.trim() && !files.length)} aria-label="Send"
            className="press grid place-items-center size-11 rounded-full bg-ink text-white hover:bg-ink-2 disabled:bg-line disabled:text-faint shrink-0">
            <Icon name="send" className="size-5" />
          </button>
        </div>
        <input ref={picker} type="file" multiple hidden accept="image/*,application/pdf,.html,.htm,.txt,.eml,message/rfc822,audio/*" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {hint && <p className="text-[13px] text-bad mt-2 px-4">{hint}</p>}
      {!hint && hero && files.length === 0 && <p className="sr-only">Files up to {MAX_MB} MB each</p>}
    </div>
  );
}
