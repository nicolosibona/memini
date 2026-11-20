"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, Empty, fmtDate, Pill } from "./ui";
import { Icon } from "./Icon";
import { ReplyBubble } from "./ReplyBubble";
import type { OutgoingReply } from "@/lib/core/reply";

export type InboxItem = {
  id: string; kind: string; received_at: string; title: string; summary: string | null; document_id: string | null; author: string | null;
  suggestion: string | null; newName: string | null; newKind: string | null; conflict: string | null;
};

export function InboxList({ items, contacts, kinds }: { items: InboxItem[]; contacts: { id: string; label: string; kind: string }[]; kinds: { key: string; label: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [newKinds, setNewKinds] = useState<Record<string, string>>({});
  const [result, setResult] = useState<OutgoingReply[]>([]);
  const [error, setError] = useState<string | null>(null);

  const submit = (it: InboxItem, action: "assign" | "skip") => start(async () => {
    setError(null);
    const sel = choice[it.id] ?? it.suggestion ?? (it.newName ? "new" : contacts[0]?.id ?? "new");
    const r = await fetch("/api/inbox", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, messageIds: [it.id], entityId: sel, name: names[it.id] ?? it.newName ?? "", kind: newKinds[it.id] ?? it.newKind ?? "supplier" }),
    });
    const j = await r.json();
    if (!r.ok) return setError(j.error ?? "Failed");
    setResult(j.replies ?? []);
    router.refresh();
  });

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg bg-bad-soft text-bad text-sm px-3 py-2">{error}</div>}
      {result.map((r, i) => (
        <div key={i} className="rounded-[10px] bg-[#ededed] p-3"><div className="text-xs text-muted mb-2">Filed — this is what WeChat would reply:</div><ReplyBubble reply={r} /></div>
      ))}
      {!items.length && <Card><Empty icon="inbox">Nothing to file. Everything you forwarded is filed.</Empty></Card>}
      {items.map((it) => {
        const sel = choice[it.id] ?? it.suggestion ?? (it.newName ? "new" : contacts[0]?.id ?? "new");
        return (
          <Card key={it.id} className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <Icon name={it.document_id ? "file" : "chat"} className="size-3.5" />
              {it.document_id ? "Document" : it.kind === "voice" ? "Voice note" : "Message"}{it.author ? ` from “${it.author}”` : ""}
              <span className="ml-auto tabular">{fmtDate(it.received_at)}</span>
            </div>
            <div className="mt-1.5 text-sm font-medium">{it.document_id ? <a className="hover:underline" href={`/documents/${it.document_id}`}>{it.title}</a> : it.title}</div>
            {it.summary && <div className="text-[13px] text-muted mt-1">{it.summary}</div>}
            {it.conflict && <div className="mt-2 text-[13px] text-warn flex gap-1.5"><Icon name="alert" className="size-3.5 mt-0.5 shrink-0" />{it.conflict}</div>}
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-line">
              <span className="text-xs text-muted">From</span>
              <select value={sel} onChange={(e) => setChoice({ ...choice, [it.id]: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 text-[13px] max-w-64">
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}{c.id === it.suggestion ? " — suggested" : ""}</option>)}
                <option value="new">+ New contact…</option>
              </select>
              {sel === "new" && (
                <>
                  <input placeholder="Name" value={names[it.id] ?? it.newName ?? ""} onChange={(e) => setNames({ ...names, [it.id]: e.target.value })} className="rounded-md border border-line px-2 py-1.5 text-[13px] w-48" />
                  <select value={newKinds[it.id] ?? it.newKind ?? "supplier"} onChange={(e) => setNewKinds({ ...newKinds, [it.id]: e.target.value })} className="rounded-md border border-line bg-card px-2 py-1.5 text-[13px]">
                    {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </>
              )}
              {it.suggestion && sel === it.suggestion && <Pill tone="info">Suggested</Pill>}
              <span className="flex-1" />
              <button disabled={pending} onClick={() => submit(it, "skip")} className="rounded-md border border-line px-3 py-1.5 text-[13px] hover:bg-hover">Don&apos;t save</button>
              <button disabled={pending} onClick={() => submit(it, "assign")} className="rounded-md bg-ink text-white px-3 py-1.5 text-[13px] hover:bg-ink-2 disabled:opacity-50">File & check</button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
