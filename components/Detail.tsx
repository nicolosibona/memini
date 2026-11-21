"use client";
// Interactive detail components: alerts with side-by-side evidence, terms with history, deadlines.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "./Icon";
import { Empty, Pill, relDay, fmtDate, severityTone } from "./ui";

export type FactView = { id: number; value: string; status: string; source: string; quote: string | null; document_id: string | null; is_document: boolean };
export type TermRowView = { key: string; label: string; current: FactView; conflicting: FactView[]; history: FactView[] };
export type AlertView = { id: number; severity: string; code: string; title: string; detail: string; evidence: (FactView & { label: string })[]; context: { href: string; label: string | null } | null };
export type TaskView = { id: number; what: string; due: string | null; kind: string; who: string; status: string; context: string | null; href: string | null };

async function patch(url: string, body: unknown) {
  const r = await fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) alert((await r.json().catch(() => ({}))).error ?? "Something went wrong");
}
function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return { pending, act: (url: string, body: unknown) => start(async () => { await patch(url, body); router.refresh(); }) };
}

const QUIET = "press rounded-full border border-line bg-card/80 px-3.5 h-8 text-[12.5px] text-ink-2 hover:bg-card hover:border-ink/25 hover:text-ink disabled:opacity-40";

function Source({ f }: { f: FactView }) {
  return (
    <div className="rounded-2xl border border-line bg-ivory px-4 py-3 text-[13.5px]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium tabular break-words min-w-0">{f.value}</span>
        <span className="text-[11.5px] text-faint inline-flex items-center gap-1 shrink-0"><Icon name={f.is_document ? "file" : "chat"} className="size-3" />{f.source}</span>
      </div>
      {f.quote && f.quote !== f.value && <div className="mt-1.5 text-ink-2 leading-relaxed">“{f.quote}”</div>}
      {f.document_id && <Link href={`/documents/${f.document_id}`} className="mt-1.5 inline-block text-[12px] text-muted underline underline-offset-2 hover:text-ink">Open document</Link>}
    </div>
  );
}

const SEV_DOT = (s: string) => (s === "red" ? "bg-bad" : s === "amber" ? "bg-warn" : "bg-info");

export function AlertList({ alerts, showContext = false }: { alerts: AlertView[]; showContext?: boolean }) {
  const { pending, act } = useAct();
  if (!alerts.length) return <Empty>Nothing needs your attention here.</Empty>;
  return (
    <div className="divide-y divide-line">
      {alerts.map((a) => (
        <div key={a.id} className="px-6 py-4">
          <div className="flex gap-3.5">
            <span className={`mt-[7px] size-2 rounded-full shrink-0 ${SEV_DOT(a.severity)}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[14.5px] font-medium leading-snug text-ink">{a.title}</div>
                <Pill tone={severityTone(a.severity)} className="shrink-0 !px-2 !py-px !text-[11px]">{a.severity === "red" ? "High" : a.severity === "amber" ? "Check" : "Info"}</Pill>
              </div>
              {a.detail && <div className="text-[13px] text-muted mt-1 leading-relaxed">{a.detail}</div>}
              {a.evidence.length > 1 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 mt-3">{a.evidence.map((e) => <Source key={e.id} f={e} />)}</div>}
              {a.evidence.length === 1 && <div className="mt-3 max-w-md"><Source f={a.evidence[0]} /></div>}
              <div className="flex flex-wrap items-center gap-2 mt-3 text-[12.5px]">
                {showContext && a.context?.label && <Link href={a.context.href} className="text-muted hover:text-ink inline-flex items-center gap-1"><Icon name="folder" className="size-3" />{a.context.label}</Link>}
                <span className="flex-1" />
                <button disabled={pending} onClick={() => act(`/api/alerts/${a.id}`, { status: "acknowledged" })} className={QUIET}>Cleared up</button>
                <button disabled={pending} onClick={() => act(`/api/alerts/${a.id}`, { status: "dismissed" })} className={QUIET}>False alarm</button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function TermsTable({ rows, empty = "Nothing on file yet." }: { rows: TermRowView[]; empty?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const { pending, act } = useAct();
  if (!rows.length) return <Empty icon="file">{empty}</Empty>;
  return (
    <div className="divide-y divide-line">
      {rows.map((r) => (
        <div key={r.key}>
          <button onClick={() => setOpen(open === r.key ? null : r.key)} aria-expanded={open === r.key}
            className="w-full grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(110px,170px)_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-6 py-3.5 text-[14px] text-left hover:bg-hover transition-colors">
            <span className="text-muted col-span-2 sm:col-span-1">{r.label}</span>
            <span className="min-w-0">
              <span className={`font-medium tabular ${r.conflicting.length ? "text-bad" : "text-ink"}`}>{r.current.value}</span>
              {r.current.status === "agreed" && <Pill tone="ok" className="ml-2">Agreed</Pill>}
              {r.conflicting.length > 0 && <span className="ml-2 text-bad text-[13px]">≠ {r.conflicting.map((c) => c.value).join(", ")}</span>}
              {r.history.length > 0 && <span className="ml-2 text-[12.5px] text-faint">was {r.history.slice(0, 2).map((h) => h.value).join(", ")}</span>}
            </span>
            <span className="text-[11.5px] text-faint whitespace-nowrap inline-flex items-center gap-1"><Icon name={r.current.is_document ? "file" : "chat"} className="size-3" />{r.current.source}</span>
          </button>
          {open === r.key && (
            <div className="px-6 pb-5 pt-1 bg-ivory/60">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Source f={r.current} />
                {r.conflicting.map((c) => <Source key={c.id} f={c} />)}
              </div>
              {r.history.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11.5px] text-faint mb-1.5">Earlier values</div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 opacity-70">{r.history.map((h) => <Source key={h.id} f={h} />)}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                {r.current.status !== "agreed" && <button disabled={pending} onClick={() => act(`/api/facts/${r.current.id}`, { status: "agreed" })} className={`${QUIET} inline-flex items-center gap-1.5`}><Icon name="check" className="size-3" />Mark as agreed</button>}
                <button disabled={pending} onClick={() => act(`/api/facts/${r.current.id}`, { status: "rejected" })} className={QUIET}>Wrongly read</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TaskList({ tasks, showContext = true, empty = "No deadlines." }: { tasks: TaskView[]; showContext?: boolean; empty?: string }) {
  const { pending, act } = useAct();
  if (!tasks.length) return <Empty icon="calendar">{empty}</Empty>;
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="divide-y divide-line">
      {tasks.map((t) => {
        const late = t.status === "open" && t.due && t.due < today;
        const done = t.status !== "open";
        return (
          <div key={t.id} className="flex items-center gap-3.5 px-6 py-3.5 text-[14px]">
            <button
              disabled={pending}
              onClick={() => act(`/api/tasks/${t.id}`, { status: done ? "open" : "done" })}
              title={done ? "Mark as open" : t.who === "counterparty" ? "They did it" : "Done"}
              aria-label={done ? "Mark as open" : "Mark as done"}
              className={`grid place-items-center size-[22px] rounded-full border shrink-0 transition-colors ${done ? "bg-ok border-ok text-white" : "border-faint/70 hover:border-ink hover:bg-hover"}`}
            >
              {done && <Icon name="check" className="size-3" />}
            </button>
            <div className={`flex-1 min-w-0 ${done ? "text-faint line-through" : "text-ink"}`}>
              <div className="line-clamp-2 leading-snug">{t.what}</div>
              {(t.who !== "me" || (showContext && t.context)) && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {t.who === "counterparty" && <Pill>Their promise</Pill>}
                  {t.who === "authority" && <Pill tone="info">Official</Pill>}
                  {showContext && t.context && (t.href ? <Link href={t.href} className="text-[12.5px] text-muted hover:text-ink">{t.context}</Link> : <span className="text-[12.5px] text-muted">{t.context}</span>)}
                </div>
              )}
            </div>
            <div className={`mono text-right text-[12.5px] w-[84px] shrink-0 ${late ? "text-bad font-medium" : "text-muted"}`}>
              <div>{t.due ? fmtDate(t.due) : "No date"}</div>
              {t.due && !done && <div className={`text-[11px] ${late ? "text-bad" : "text-faint"}`}>{relDay(t.due)}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
