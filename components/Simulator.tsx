"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReplyBubble } from "./ReplyBubble";
import { Icon } from "./Icon";
import type { OutgoingReply } from "@/lib/core/reply";

type Draft =
  | { kind: "text"; text: string }
  | { kind: "merged"; text: string; originalAuthor: string; chatTitle: string }
  | { kind: "voice"; text: string }
  | { kind: "file"; demoFile?: string; file?: File; name: string };
type Line = { from: "user"; label: string } | { from: "bot"; reply: OutgoingReply } | { from: "system"; label: string };

const STORE = "memini-sim-log-v2";
const load = (): Line[] => { try { return JSON.parse(localStorage.getItem(STORE) ?? "[]"); } catch { return []; } };
const save = (l: Line[]) => { try { localStorage.setItem(STORE, JSON.stringify(l.slice(-80))); } catch { /* private mode */ } };

function Chip({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="rounded-md border border-line bg-card px-2.5 py-1 text-[12.5px] text-ink-2 hover:bg-hover text-left">{children}</button>;
}

export function Simulator({ demoFiles, demoTexts, business }: { demoFiles: { file: string; label: string; group: string }[]; demoTexts: Record<string, string>; business: boolean }) {
  const router = useRouter();
  const [log, setLog] = useState<Line[]>([]);
  const [queue, setQueue] = useState<Draft[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"text" | "merged" | "voice">("text");
  const [author, setAuthor] = useState("Lisa 🌸 Sales");
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => setLog(load()), []);
  useEffect(() => { save(log); end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [log]);

  async function post(items: unknown[], files: File[] = []) {
    setBusy(true);
    try {
      let res: Response;
      if (files.length) {
        const form = new FormData();
        form.set("items", JSON.stringify(items));
        files.forEach((f, i) => form.set(`f${i}`, f));
        res = await fetch("/api/sim", { method: "POST", body: form });
      } else res = await fetch("/api/sim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? res.statusText);
      setMs(j.ms);
      setLog((l) => [...l, ...(j.replies as OutgoingReply[]).map((r) => ({ from: "bot" as const, reply: r }))]);
      router.refresh();
    } catch (e) {
      setLog((l) => [...l, { from: "system", label: `Error: ${String(e)}` }]);
    } finally { setBusy(false); }
  }

  const draftFromInput = (): Draft | null => !text.trim() ? null
    : mode === "merged" ? { kind: "merged", text, originalAuthor: author, chatTitle: `Chat with ${author}` } : mode === "voice" ? { kind: "voice", text } : { kind: "text", text };

  async function sendQueue() {
    const d = draftFromInput();
    const drafts = d ? [...queue, d] : queue;
    if (!drafts.length || busy) return;
    const files: File[] = [];
    const items = drafts.map((x) => {
      if (x.kind === "file") {
        if (x.demoFile) return { kind: "file", demoFile: x.demoFile };
        files.push(x.file!);
        return { kind: x.file!.type.startsWith("image/") ? "image" : "file", fileField: `f${files.length - 1}` };
      }
      if (x.kind === "voice") return { kind: "voice", transcriptHint: x.text, text: x.text };
      return x;
    });
    setLog((l) => [...l, ...drafts.map((x): Line => ({ from: "user", label: x.kind === "file" ? `📄 ${x.name}` : x.kind === "merged" ? `[Chat history] ${x.originalAuthor}: ${x.text}` : x.kind === "voice" ? `🎙 ${x.text}` : x.text }))]);
    setQueue([]); setText("");
    await post(items, files);
  }

  async function tap(id: string, label: string) {
    setLog((l) => [...l, { from: "user", label }]);
    await post([{ kind: "text", text: label, menuId: id }]);
  }

  async function reset(profile: "sourcing" | "china_business") {
    if (!confirm(`Reset all data to the "${profile === "sourcing" ? "Sourcing buyer" : "Doing business in China"}" demo?`)) return;
    await fetch("/api/demo/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile }) });
    setLog([{ from: "system", label: "Demo data reset." }]); setQueue([]);
    router.refresh();
  }

  const groups = [...new Set(demoFiles.map((d) => d.group))].filter((g) => business || g === "Sourcing");

  return (
    <div className="grid gap-8 lg:grid-cols-[380px_1fr] items-start">
      {/* phone */}
      <div className="mx-auto w-full max-w-[380px] rounded-[36px] bg-[#1c1c1e] p-2.5 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.35)]">
        <div className="rounded-[28px] overflow-hidden bg-[#ededed]">
          <div className="bg-[#ededed] border-b border-black/[0.06] px-4 pt-3 pb-2.5 text-center">
            <div className="text-[15px] font-medium">Memini</div>
            <div className="text-[11px] text-muted">微信客服</div>
          </div>
          <div className="h-[540px] overflow-y-auto px-3 py-3 space-y-3">
            {log.length === 0 && <div className="text-center text-xs text-muted mt-10 px-6">Forward something to start — use the examples on the right.</div>}
            {log.map((line, i) =>
              line.from === "user" ? (
                <div key={i} className="flex justify-end"><div className="max-w-[80%] rounded-md bg-[#95ec69] px-3 py-2 text-[14px] leading-[1.55] whitespace-pre-wrap break-words">{line.label}</div></div>
              ) : line.from === "bot" ? (
                <div key={i} className="flex gap-2 items-start"><div className="size-8 shrink-0 rounded-md bg-brand text-white grid place-items-center font-[family-name:var(--font-seal)] text-sm">印</div><ReplyBubble reply={line.reply} disabled={busy} onButton={(id, label) => tap(id, label)} /></div>
              ) : <div key={i} className="text-center text-[11px] text-muted">{line.label}</div>,
            )}
            {busy && <div className="flex gap-2"><div className="size-8 rounded-md bg-brand text-white grid place-items-center font-[family-name:var(--font-seal)] text-sm">印</div><div className="rounded-md bg-white px-3 py-2 text-sm text-muted">Reading…</div></div>}
            <div ref={end} />
          </div>
          {queue.length > 0 && (
            <div className="bg-[#f7f7f7] border-t border-black/[0.06] px-3 py-2 text-xs flex flex-wrap gap-1.5 items-center">
              {queue.map((q, i) => (
                <span key={i} className="rounded bg-white border border-black/10 pl-1.5 pr-1 py-0.5 inline-flex items-center gap-1">
                  {q.kind === "file" ? q.name : q.kind === "voice" ? "voice note" : q.kind === "merged" ? "chat history" : "text"}
                  <button className="text-muted" onClick={() => setQueue(queue.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" className="size-3" /></button>
                </span>
              ))}
              <span className="text-muted">→ sent together</span>
            </div>
          )}
          <div className="bg-[#f7f7f7] border-t border-black/[0.06] p-2 space-y-2">
            <div className="flex gap-1 text-[11.5px]">
              {(["text", "merged", "voice"] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)} className={`rounded px-2 py-0.5 ${mode === m ? "bg-white shadow-sm font-medium" : "text-muted"}`}>{m === "text" ? "Text" : m === "merged" ? "Chat history" : "My voice note"}</button>
              ))}
            </div>
            {mode === "merged" && <input value={author} onChange={(e) => setAuthor(e.target.value)} className="w-full rounded border border-black/10 bg-white px-2 py-1 text-xs" placeholder="Their WeChat nickname" />}
            <div className="flex gap-2">
              <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendQueue(); } }} rows={2}
                placeholder={mode === "voice" ? "What you say (transcript)…" : "Paste a message or ask a question…"} className="flex-1 resize-none rounded bg-white border border-black/10 px-2 py-1.5 text-sm" />
              <div className="flex flex-col gap-1">
                <button disabled={busy} onClick={() => void sendQueue()} className="rounded bg-[#07c160] text-white px-3 py-1 text-sm disabled:opacity-50">Send</button>
                <button disabled={busy || !text.trim()} onClick={() => { const d = draftFromInput(); if (d) { setQueue((q) => [...q, d]); setText(""); } }} title="Queue several items and send them as one forward" className="rounded bg-white border border-black/10 px-2 py-0.5 text-[11px] disabled:opacity-40">+ Queue</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* examples */}
      <div className="space-y-6 text-sm">
        <section>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-2 mb-2">Messages</h2>
          <div className="flex flex-wrap gap-2">
            <Chip onClick={() => { setMode("text"); setText(demoTexts.lisa); }}>Supplier: Lisa&apos;s quote (no company name)</Chip>
            <Chip onClick={() => { setMode("merged"); setAuthor("Lisa 🌸 Sales"); setText(demoTexts.lisa); }}>Same, as chat history from “Lisa 🌸 Sales”</Chip>
            {business && <Chip onClick={() => { setMode("merged"); setAuthor("周先生 静安置业"); setText(demoTexts.landlord); }}>Landlord&apos;s agent: sign and pay the deposit</Chip>}
          </div>
        </section>
        {groups.map((g) => (
          <section key={g}>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-2 mb-2">Documents · {g}</h2>
            <div className="flex flex-wrap gap-2">
              {demoFiles.filter((d) => d.group === g).map((d) => <Chip key={d.file} onClick={() => setQueue((q) => [...q, { kind: "file", demoFile: d.file, name: d.label }])}>+ {d.label}</Chip>)}
              {g === groups[0] && <Chip onClick={() => fileInput.current?.click()}>+ Your own file…</Chip>}
            </div>
          </section>
        ))}
        <input ref={fileInput} type="file" multiple hidden accept="image/*,application/pdf,.html,.txt" onChange={(e) => { const fs = [...(e.target.files ?? [])]; setQueue((q) => [...q, ...fs.map((f) => ({ kind: "file" as const, file: f, name: f.name }))]); e.target.value = ""; }} />
        <section>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-ink-2 mb-2">Questions</h2>
          <div className="flex flex-wrap gap-2">
            {[demoTexts.question, "What's due this month?", "Any open issues before I pay the deposit?", "What did Lisa promise me?", "Write a polite follow-up in Chinese to Seller 1 about the sample"].map((q) => <Chip key={q} onClick={() => { setMode("text"); setText(q); }}>{q}</Chip>)}
          </div>
          <p className="text-xs text-muted mt-2">Commands: <code>/today</code> · <code>/deadlines</code> · <code>/alerts</code> · <code>/contacts</code> · <code>/seller1</code> · <code>agreed</code></p>
        </section>
        <section className="flex flex-wrap items-center gap-2 pt-2 border-t border-line">
          <button onClick={() => reset("china_business")} className="rounded-md border border-line bg-card px-2.5 py-1 text-[12.5px] hover:bg-hover">Reset · business demo</button>
          <button onClick={() => reset("sourcing")} className="rounded-md border border-line bg-card px-2.5 py-1 text-[12.5px] hover:bg-hover">Reset · sourcing demo</button>
          <button onClick={() => setLog([])} className="rounded-md border border-line bg-card px-2.5 py-1 text-[12.5px] hover:bg-hover">Clear chat</button>
          {ms != null && <span className="text-xs text-muted tabular">last reply {(ms / 1000).toFixed(1)} s</span>}
        </section>
      </div>
    </div>
  );
}
