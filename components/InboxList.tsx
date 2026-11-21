"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, Empty, btnCls, fmtDate, Pill } from "./ui";
import { Icon } from "./Icon";
import { ReplyBubble } from "./ReplyBubble";
import type { OutgoingReply } from "@/lib/core/reply";

export type InboxItem = {
  id: string; kind: string; received_at: string; title: string; summary: string | null; document_id: string | null; author: string | null;
  suggestion: string | null; newName: string | null; newKind: string | null; conflict: string | null;
};

const PILL_FIELD = "rounded-full border border-line bg-card px-3.5 h-9 text-[13px] text-ink placeholder:text-faint focus-visible:border-ink/40";

export function InboxList({ items, contacts, kinds, compact = false }: { items: InboxItem[]; contacts: { id: string; label: string; kind: string }[]; kinds: { key: string; label: string }[]; compact?: boolean }) {
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

  const pad = compact ? "p-4" : "p-6";
  return (
    <div className={compact ? "space-y-2.5" : "space-y-3.5"}>
      {error && <div className="rounded-2xl bg-bad-soft text-bad text-[14px] px-4 py-2.5">{error}</div>}
      {result.map((r, i) => (
        <div key={i} className={`rise rounded-3xl border border-ok/20 bg-ok-soft/50 ${pad}`}>
          <div className="text-[13px] font-medium text-ok mb-3 flex items-center gap-1.5"><Icon name="check" className="size-3.5" />Filed. Here is what I found:</div>
          <ReplyBubble reply={r} />
        </div>
      ))}
      {!items.length && !result.length && <Card><Empty icon="inbox">Nothing to file. Everything you forwarded is filed.</Empty></Card>}
      {items.map((it) => {
        const sel = choice[it.id] ?? it.suggestion ?? (it.newName ? "new" : contacts[0]?.id ?? "new");
        return (
          <Card key={it.id} className={pad}>
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Icon name={it.document_id ? "file" : "chat"} className="size-3.5" />
              <span className="truncate">{it.document_id ? "Document" : it.kind === "voice" ? "Voice note" : "Message"}{it.author ? ` from “${it.author}”` : ""}</span>
              <span className="ml-auto mono text-faint shrink-0">{fmtDate(it.received_at)}</span>
            </div>
            <div className={`mt-2 font-medium text-ink break-words ${compact ? "text-[14px]" : "text-[15px]"}`}>{it.document_id ? <a className="hover:underline" href={`/documents/${it.document_id}`}>{it.title}</a> : it.title}</div>
            {it.summary && <div className="text-[13px] text-muted mt-1 leading-relaxed line-clamp-3">{it.summary}</div>}
            {it.conflict && <div className="mt-2.5 text-[13px] text-warn flex gap-1.5"><Icon name="alert" className="size-3.5 mt-0.5 shrink-0" />{it.conflict}</div>}
            <div className={`flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-line`}>
              <span className="text-[12.5px] text-muted">From</span>
              <select value={sel} onChange={(e) => setChoice({ ...choice, [it.id]: e.target.value })} aria-label="Contact" className={`${PILL_FIELD} min-w-0 max-w-full ${compact ? "w-full sm:w-auto sm:max-w-56" : "max-w-64"}`}>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}{c.id === it.suggestion ? " — suggested" : ""}</option>)}
                <option value="new">+ New contact…</option>
              </select>
              {sel === "new" && (
                <>
                  <input placeholder="Name" aria-label="New contact name" value={names[it.id] ?? it.newName ?? ""} onChange={(e) => setNames({ ...names, [it.id]: e.target.value })} className={`${PILL_FIELD} w-full sm:w-48`} />
                  <select value={newKinds[it.id] ?? it.newKind ?? "supplier"} onChange={(e) => setNewKinds({ ...newKinds, [it.id]: e.target.value })} aria-label="Contact kind" className={PILL_FIELD}>
                    {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                  </select>
                </>
              )}
              {it.suggestion && sel === it.suggestion && <Pill tone="info">Suggested</Pill>}
              <span className="flex-1" />
              <button disabled={pending} onClick={() => submit(it, "skip")} className={btnCls("secondary", "sm")}>Don&apos;t save</button>
              <button disabled={pending} onClick={() => submit(it, "assign")} className={btnCls("primary", "sm")}>File &amp; check</button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
