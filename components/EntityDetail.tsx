// Contact page body — shared by /contacts/[id] and the mobile page opened from WeChat links.
import Link from "next/link";
import type { DB } from "@/lib/db";
import { entityProfile, timeline, termValue } from "@/lib/core/memory";
import { MATTER_KINDS, ENTITY_KINDS } from "@/lib/core/domain";
import { trustLight } from "@/lib/core/audit";
import { alertViews, taskViews, termRows } from "@/lib/views";
import { AlertList, TaskList, TermsTable } from "./Detail";
import { Card, Section, TrustPill, Empty, fmtDate } from "./ui";
import { Icon, MATTER_ICON, ENTITY_ICON } from "./Icon";

export function EntityDetail({ db, id, compact = false }: { db: DB; id: string; compact?: boolean }) {
  const p = entityProfile(db, id)!;
  const e = p.entity;
  const events = compact ? [] : timeline(db, { entityId: id }, 30);
  const company = termRows(p.company, "company");
  const titleOf = (mid: string) => p.matters.find((m) => m.id === mid)?.title ?? null;
  const KEY = ["unit_price", "incoterm", "lead_time_days", "rent_amount", "amount_due", "expiry_date"];

  return (
    <div className="rise">
      <header className="mb-6">
        <div className="flex items-center gap-1.5 text-[12.5px] text-muted mb-2"><Icon name={ENTITY_ICON[e.kind]} className="size-3.5" />{ENTITY_KINDS[e.kind].label}{e.label !== e.display_name && <> · {e.label}</>}</div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="display text-[40px] leading-[1.05]">{e.display_name}</h1>
          {!e.kind.startsWith("self") && <TrustPill trust={p.trust} />}
        </div>
        <div className="text-[14px] text-muted mt-1 flex flex-wrap gap-x-3">
          {e.legal_name_zh && <span>{e.legal_name_zh}</span>}
          {e.legal_name_en && <span>{e.legal_name_en}</span>}
        </div>
        {(e.credit_code || e.registry_status) && (
          <div className="text-[12.5px] text-muted mt-1.5 font-mono">
            {e.credit_code ? `USCC ${e.credit_code}` : "No credit code yet"}{e.registry_status && e.registry_status !== "unknown" ? ` · registry: ${e.registry_status}` : ""}
          </div>
        )}
      </header>

      <div className={`grid grid-cols-1 gap-x-8 ${compact ? "" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}>
        <div className="min-w-0">
          <Section title="Checks" right={`${p.alerts.length} open`}>
            <Card><AlertList alerts={alertViews(db, p.alerts, { matterTitle: titleOf })} showContext /></Card>
          </Section>
          <Section title={e.kind === "supplier" ? "Purchases" : "Matters"}>
            <Card className="divide-y divide-line">
              {p.matters.map((m) => {
                const key = m.terms.filter((t) => KEY.includes(t.key)).slice(0, 3);
                return (
                  <Link key={m.id} href={`/matters/${m.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-hover">
                    <span className="grid place-items-center size-9 rounded-xl bg-line-2 text-ink-2 shrink-0"><Icon name={MATTER_ICON[m.kind]} className="size-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[14px] font-medium truncate">{m.title}</span>
                      <span className="block text-[12.5px] text-muted truncate">{MATTER_KINDS[m.kind].label}{key.length ? " · " + key.map((t) => termValue(t)).join(" · ") : ""}</span>
                    </span>
                    <TrustPill trust={trustLight(db, { matterId: m.id })} />
                  </Link>
                );
              })}
              {!p.matters.length && <Empty icon="folder">No matters with them yet.</Empty>}
            </Card>
          </Section>
          {company.length > 0 && (
            <Section title="Company record">
              <Card><TermsTable rows={company} /></Card>
            </Section>
          )}
          {!compact && (
            <Section title="History">
              <Card className="divide-y divide-line">
                {events.map((ev, i) => (
                  <div key={i} className="flex gap-3 px-5 py-2.5 text-[13px]">
                    <span className="text-muted w-14 shrink-0 tabular">{fmtDate(ev.at)}</span>
                    <Icon name={ev.kind === "document" ? "file" : ev.kind === "alert" ? "alert" : ev.kind === "message" ? "chat" : "dot"} className="size-3.5 text-faint mt-0.5 shrink-0" />
                    {ev.kind === "document" ? <Link href={`/documents/${ev.ref}`} className="hover:underline">{ev.text}</Link> : <span className="min-w-0 break-words text-ink-2">{ev.text}</span>}
                  </div>
                ))}
                {!events.length && <Empty>Nothing yet.</Empty>}
              </Card>
            </Section>
          )}
        </div>
        <aside>
          <Section title="Deadlines">
            <Card><TaskList tasks={taskViews(p.tasks.filter((t) => t.status === "open"))} /></Card>
          </Section>
          <Section title="Documents">
            <Card className="divide-y divide-line">
              {p.documents.map((d) => (
                <Link key={d.id} href={`/documents/${d.id}`} className="flex items-center gap-2.5 px-5 py-2.5 text-[13px] hover:bg-hover">
                  <Icon name="file" className="size-3.5 text-muted" /><span className="flex-1 truncate">{d.title}</span><span className="text-[12.5px] text-muted">{fmtDate(d.created_at)}</span>
                </Link>
              ))}
              {!p.documents.length && <Empty icon="file">None yet.</Empty>}
            </Card>
          </Section>
          {p.contacts.length > 0 && (
            <Section title="People">
              <Card className="divide-y divide-line">
                {p.contacts.map((c, i) => <div key={i} className="px-5 py-2.5 text-[13px]">{c.name} <span className="text-muted">· WeChat “{c.wechat_nickname}”</span></div>)}
              </Card>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
