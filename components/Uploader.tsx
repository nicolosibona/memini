"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ReplyBubble } from "./ReplyBubble";
import { Card } from "./ui";
import { Icon } from "./Icon";
import type { OutgoingReply } from "@/lib/core/reply";

const MAX_MB = 20;

export function Uploader() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ file: string; replies: OutgoingReply[] }[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const add = (list: File[]) => {
    const tooBig = list.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig.length) setError(`${tooBig.map((f) => f.name).join(", ")}: larger than ${MAX_MB} MB`);
    setFiles((f) => [...f, ...list.filter((x) => x.size <= MAX_MB * 1024 * 1024)]);
  };

  async function upload() {
    if (!files.length && !text.trim()) return;
    setBusy(true); setError(null);
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (text.trim()) form.set("text", text);
    try {
      const r = await fetch("/api/ingest", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setResults(j.results ?? []); setFiles([]); setText("");
      router.refresh();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }

  async function tap(id: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/sim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [{ kind: "text", menuId: id }] }) });
      const j = await r.json();
      setResults((rs) => [...rs, { file: "Your answer", replies: j.replies ?? [] }]);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
        onClick={() => input.current?.click()} role="button" tabIndex={0}
        className={`cursor-pointer rounded-[10px] border border-dashed p-10 text-center transition-colors ${over ? "border-ink bg-hover" : "border-faint bg-card hover:bg-hover"}`}
      >
        <Icon name="upload" className="size-6 mx-auto text-muted" />
        <div className="text-sm font-medium mt-2">Drop files or click to choose</div>
        <div className="text-xs text-muted mt-0.5">PDF, photos, HTML or text · up to {MAX_MB} MB each · several at once</div>
        <input ref={input} type="file" multiple hidden accept="image/*,application/pdf,.html,.htm,.txt,audio/*" onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <Card className="divide-y divide-line">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 text-[13px]">
              <Icon name="file" className="size-3.5 text-muted" /><span className="flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted tabular">{(f.size / 1024).toFixed(0)} KB</span>
              <button className="text-muted hover:text-ink" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" className="size-3.5" /></button>
            </div>
          ))}
        </Card>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="…or paste a message someone sent you" className="w-full rounded-[10px] border border-line bg-card px-3 py-2 text-sm placeholder:text-faint" />
      {error && <div className="rounded-lg bg-bad-soft text-bad text-sm px-3 py-2">{error}</div>}
      <button disabled={busy || (!files.length && !text.trim())} onClick={upload} className="rounded-lg bg-ink text-white px-4 py-2 text-[13px] font-medium disabled:opacity-40">
        {busy ? "Reading…" : files.length ? `Read ${files.length} file${files.length > 1 ? "s" : ""}` : "Read"}
      </button>
      {results.map((r, i) => (
        <div key={i} className="rounded-[10px] bg-[#ededed] p-3">
          <div className="text-xs text-muted mb-2">{r.file}</div>
          <div className="space-y-2">{r.replies.map((rep, j) => <ReplyBubble key={j} reply={rep} disabled={busy} onButton={(id) => tap(id)} />)}</div>
        </div>
      ))}
    </div>
  );
}
