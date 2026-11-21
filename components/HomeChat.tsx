"use client";
// Home: one roomy conversation with Memini. Ask a question, paste what someone sent you, or drop a file —
// the same core as the WeChat bot answers. Before the first message, what matters from memory sits below.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import { Mark } from "./Sidebar";
import { ChineseCard, withoutDraft } from "./ReplyBubble";
import type { OutgoingReply } from "@/lib/core/reply";

type Turn =
  | { role: "user"; text: string; files?: string[] }
  | { role: "bot"; replies: OutgoingReply[]; ms?: number }
  | { role: "error"; text: string };

const STORE = "memini-home-chat-v1";
const load = (): Turn[] => { try { return JSON.parse(localStorage.getItem(STORE) ?? "[]"); } catch { return []; } };
const save = (t: Turn[]) => { try { localStorage.setItem(STORE, JSON.stringify(t.slice(-60))); } catch { /* private mode */ } };
const MAX_MB = 20;

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
            {text && <div className="text-[15.5px] leading-[1.7] text-ink whitespace-pre-wrap break-words"><Linkified text={text} /></div>}
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
        {turn.ms != null && <div className="text-[12.5px] text-faint tabular">{(turn.ms / 1000).toFixed(1)} s</div>}
      </div>
    </div>
  );
}

export function HomeChat({ eyebrow, greeting, prompt, suggestions, children }: { eyebrow: ReactNode; greeting: string; prompt: string; suggestions: string[]; children: ReactNode }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const chatting = turns.length > 0;

  useEffect(() => setTurns(load()), []);
  useEffect(() => { save(turns); if (turns.length) end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [turns]);
  useEffect(() => { const a = area.current; if (a) { a.style.height = "0px"; a.style.height = `${Math.min(a.scrollHeight, 220)}px`; } }, [text]);

  const addFiles = (list: File[]) => {
    const big = list.filter((f) => f.size > MAX_MB * 1048576);
    setHint(big.length ? `${big.map((f) => f.name).join(", ")}: larger than ${MAX_MB} MB` : null);
    setFiles((f) => [...f, ...list.filter((x) => x.size <= MAX_MB * 1048576)]);
  };

  async function post(body: FormData | { text?: string; menuId?: string }) {
    setBusy(true);
    try {
      const r = body instanceof FormData
        ? await fetch("/api/chat", { method: "POST", body })
        : await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({ error: r.statusText }));
        throw new Error(j.error ?? r.statusText);
      }
      // NDJSON stream: each reply appears as soon as it's ready (the translation first), in one bot turn
      let started = false;
      const addReply = (reply: OutgoingReply) => setTurns((t) => {
        if (!started) { started = true; return [...t, { role: "bot", replies: [reply] }]; }
        const last = t[t.length - 1];
        return last?.role === "bot" ? [...t.slice(0, -1), { ...last, replies: [...last.replies, reply] }] : [...t, { role: "bot", replies: [reply] }];
      });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as { type: "reply"; reply: OutgoingReply } | { type: "done"; ms: number } | { type: "error"; error: string };
          if (ev.type === "reply") addReply(ev.reply);
          else if (ev.type === "error") throw new Error(ev.error);
          else setTurns((t) => {
            const last = t[t.length - 1];
            return last?.role === "bot" && started ? [...t.slice(0, -1), { ...last, ms: ev.ms }] : [...t, { role: "bot", replies: [], ms: ev.ms }];
          });
        }
        if (done) break;
      }
      router.refresh();
    } catch (e) {
      setTurns((t) => [...t, { role: "error", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
      area.current?.focus();
    }
  }

  async function send(q = text) {
    if (busy || (!q.trim() && !files.length)) return;
    const sent = files;
    setTurns((t) => [...t, { role: "user", text: q.trim(), files: sent.map((f) => f.name) }]);
    setText(""); setFiles([]); setHint(null);
    if (sent.length) {
      const form = new FormData();
      sent.forEach((f) => form.append("files", f));
      if (q.trim()) form.set("text", q.trim());
      await post(form);
    } else await post({ text: q.trim() });
  }

  async function tap(id: string, label: string) {
    setTurns((t) => [...t, { role: "user", text: label }]);
    await post({ menuId: id, text: label });
  }

  const composer = (
    <div className={`rounded-[26px] border bg-card transition-[border-color,box-shadow] ${over ? "border-brand shadow-[0_0_0_4px_var(--color-brand-soft)]" : "border-line shadow-[0_1px_2px_rgb(26_25_23/0.04),0_12px_32px_-16px_rgb(26_25_23/0.12)] focus-within:border-ink/25"}`}>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3.5">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-2 rounded-full bg-line-2 pl-3 pr-1.5 h-8 text-[13px] max-w-full">
              <Icon name={f.type.startsWith("image/") ? "image" : "file"} className="size-3.5 text-muted shrink-0" />
              <span className="truncate max-w-52">{f.name}</span>
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="grid place-items-center size-6 rounded-full hover:bg-line text-muted"><Icon name="x" className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2 p-2.5 pl-3">
        <button type="button" onClick={() => picker.current?.click()} aria-label="Attach files" title="Attach documents or photos"
          className="press grid place-items-center size-10 rounded-full text-muted hover:text-ink hover:bg-hover shrink-0">
          <Icon name="clip" className="size-5" />
        </button>
        <textarea ref={area} value={text} rows={1} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
          placeholder={prompt} aria-label="Message Memini"
          className="flex-1 resize-none bg-transparent py-2.5 text-[16px] leading-6 placeholder:text-faint outline-none focus-visible:outline-none min-h-11" />
        <button type="button" onClick={() => void send()} disabled={busy || (!text.trim() && !files.length)} aria-label="Send"
          className="press grid place-items-center size-10 rounded-full bg-brand text-white hover:bg-brand-dark disabled:bg-line disabled:text-faint shrink-0">
          <Icon name="send" className="size-5" />
        </button>
      </div>
      <input ref={picker} type="file" multiple hidden accept="image/*,application/pdf,.html,.htm,.txt,.eml,message/rfc822,audio/*" onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
    </div>
  );

  return (
    <div
      className="relative min-h-[calc(100vh-56px)] md:min-h-screen flex flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); area.current?.focus(); }}
    >
      {!chatting ? (
        <div className="px-4 sm:px-8">
          <section className="mx-auto max-w-[760px] pt-[12vh] sm:pt-[16vh] pb-14">
            <div className="enter text-[13px] font-medium text-muted mb-5 flex items-center gap-2">{eyebrow}</div>
            <h1 className="enter display text-[44px] sm:text-[64px] leading-[1.02] text-ink">{greeting}</h1>
            <div className="enter-2 mt-9">{composer}</div>
            {hint && <p className="text-[13px] text-bad mt-2 px-4">{hint}</p>}
            <div className="enter-3 flex flex-wrap gap-2 mt-5">
              {suggestions.map((s) => (
                <button key={s} onClick={() => void send(s)} className="press rounded-full border border-line bg-card/60 px-3.5 h-9 text-[13.5px] text-ink-2 hover:bg-card hover:text-ink hover:border-ink/20">
                  {s}
                </button>
              ))}
            </div>
          </section>
          <div className="enter-3 mx-auto max-w-[1040px] pb-20">{children}</div>
        </div>
      ) : (
        <>
          <div className="sticky top-14 md:top-0 z-10 bg-paper/90 backdrop-blur border-b border-line">
            <div className="mx-auto max-w-[760px] px-4 sm:px-8 h-14 flex items-center justify-between">
              <span className="text-[14px] text-muted">Conversation</span>
              <button onClick={() => { setTurns([]); setText(""); setFiles([]); }} className="press inline-flex items-center gap-1.5 rounded-full border border-line bg-card h-9 px-3.5 text-[13.5px] hover:bg-hover">
                <Icon name="plus" className="size-4" />New conversation
              </button>
            </div>
          </div>
          <div className="flex-1 mx-auto w-full max-w-[760px] px-4 sm:px-8 py-10 space-y-9">
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
              <div className={`flex gap-3.5 items-center ${turns[turns.length - 1]?.role === "bot" ? "pl-[42px] -mt-6" : ""}`}>
                {turns[turns.length - 1]?.role !== "bot" && <Mark size="sm" />}
                <span className="typing text-[22px] leading-none text-muted tracking-widest"><span>·</span><span>·</span><span>·</span></span>
              </div>
            )}
            <div ref={end} className="scroll-mb-44" />
          </div>
          <div className="sticky bottom-0 bg-linear-to-t from-paper via-paper to-paper/0 pt-6 pb-5">
            <div className="mx-auto max-w-[760px] px-4 sm:px-8">
              {composer}
              {hint && <p className="text-[13px] text-bad mt-2 px-4">{hint}</p>}
              <p className="text-[12.5px] text-faint text-center mt-2.5">Same assistant as on WeChat · answers only from what you&apos;ve forwarded</p>
            </div>
          </div>
        </>
      )}
      {over && (
        <div className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-paper/70 backdrop-blur-[2px]">
          <div className="rounded-3xl border-2 border-dashed border-brand bg-card px-10 py-8 text-center">
            <Icon name="upload" className="size-7 text-brand mx-auto" />
            <div className="mt-3 text-[16px] font-medium">Drop to give it to Memini</div>
            <div className="text-[13px] text-muted mt-1">Licenses, contracts, invoices, photos · up to {MAX_MB} MB each</div>
          </div>
        </div>
      )}
    </div>
  );
}
