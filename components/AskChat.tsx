"use client";
import { useState } from "react";
import { Card } from "./ui";
import { Icon } from "./Icon";

type Turn = { q: string; a?: string; source?: string; ms?: number; error?: boolean };

export function AskChat({ examples }: { examples: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true); setQ("");
    setTurns((t) => [...t, { q: question }]);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question }) });
      const j = await r.json();
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: j.text ?? j.error, source: j.source, ms: j.ms, error: !r.ok } : x)));
    } catch (e) {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: String(e), error: true } : x)));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      {turns.map((t, i) => (
        <div key={i} className="space-y-2">
          <div className="flex justify-end"><div className="rounded-2xl rounded-br-md bg-ink text-white px-3.5 py-2 text-sm max-w-[80%]">{t.q}</div></div>
          <Card className={`px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed ${t.error ? "text-bad" : ""}`}>
            {t.a ?? <span className="text-muted inline-flex items-center gap-2"><Icon name="sparkle" className="size-3.5 animate-pulse" />Looking through your records…</span>}
            {t.source && <div className="text-[11px] text-faint mt-2">{t.source === "live" ? "AI answer" : t.source === "mock" ? "Rule-based answer (no AI model connected)" : "Rule-based fallback (AI unavailable)"} · {((t.ms ?? 0) / 1000).toFixed(1)} s</div>}
          </Card>
        </div>
      ))}
      {!turns.length && (
        <div className="flex flex-wrap gap-2">
          {examples.map((e) => <button key={e} onClick={() => send(e)} className="rounded-full border border-line bg-card px-3 py-1.5 text-[13px] text-ink-2 hover:bg-hover">{e}</button>)}
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void send(q); }} className="flex gap-2 sticky bottom-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your suppliers, matters or deadlines…" className="flex-1 rounded-[10px] border border-line bg-card px-3.5 py-2.5 text-sm shadow-sm placeholder:text-faint" />
        <button disabled={busy || !q.trim()} className="rounded-[10px] bg-ink text-white px-4 text-[13px] font-medium disabled:opacity-40">Ask</button>
      </form>
    </div>
  );
}
