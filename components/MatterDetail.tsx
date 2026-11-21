// Matter page body — shared by /matters/[id] and the mobile page opened from WeChat links.
import Link from "next/link";
import type { DB } from "@/lib/db";
import { matterView, timeline } from "@/lib/core/memory";
import { comparableGroups } from "@/lib/core/matters";
import { entityLabel } from "@/lib/core/entities";
import { MATTER_KINDS, ENTITY_KINDS } from "@/lib/core/domain";
import { alertViews, taskViews, termRows } from "@/lib/views";
import { AlertList, TaskList, TermsTable } from "./Detail";
import { MatterActions } from "./MatterActions";
import { ConfirmLinkPanel } from "./ConfirmLinkPanel";
import { canReplyTo } from "@/lib/core/reply";
import { Card, Section, TrustPill, Empty, Progress, fmtDate, Pill } from "./ui";
import { Icon, MATTER_ICON } from "./Icon";

export function MatterDetail({ db, id, compact = false }: { db: DB; id: string; compact?: boolean }) {
  const v = matterView(db, id)!;
  const m = v.matter;
  const done = v.checklist.filter((c) => c.done).length;
  const group = m.kind === "purchase" ? comparableGroups(db, m.workspace_id).find((g) => g.matters.some((x) => x.id === m.id)) : undefined;
  const events = compact ? [] : timeline(db, { matterId: id }, 30);
  const terms = termRows(v.terms, "terms");

  return (
    <div className="rise">
      <header className="mb-6">
        <div className="flex items-center gap-2 text-[12.5px] text-muted mb-2">
          <Icon name={MATTER_ICON[m.kind]} className="size-3.5" />{MATTER_KINDS[m.kind].label}
          {v.entity && <>· <Link href={`/contacts/${v.entity.id}`} className="hover:text-ink">{entityLabel(v.entity)}</Link></>}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="display text-[40px] leading-[1.05]">{m.title}</h1>
          <div className="flex items-center gap-2">
            <TrustPill trust={v.trust} />
            {!compact && <MatterActions id={m.id} status={m.status} subject={m.subject} kind={m.kind} />}
          </div>
        </div>
        {m.subject && m.subject !== m.title && <p className="text-[14px] text-muted mt-1">About: {m.subject}</p>}
        {group && group.matters.length > 1 && (
          <Link href={`/compare#${encodeURIComponent(group.key)}`} className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-info hover:underline">
            <Icon name="scale" className="size-3.5" />Compare with {group.matters.length - 1} other quote{group.matters.length > 2 ? "s" : ""} for {group.subject}
          </Link>
        )}
      </header>

      <div className={`grid grid-cols-1 gap-x-8 ${compact ? "" : "lg:grid-cols-[minmax(0,1fr)_320px]"}`}>
        <div className="min-w-0">
          <Section title="Checks" right={`${v.alerts.length} open`}>
            <Card><AlertList alerts={alertViews(db, v.alerts)} /></Card>
          </Section>
          <Section title={m.kind === "purchase" ? "Current terms" : "Key facts"} right="Click a value for its source">
            <Card><TermsTable rows={terms} empty="No terms yet — forward a quote, contract or message." /></Card>
          </Section>
          {!compact && (
            <Section title="History">
              <Card className="divide-y divide-line">
                {events.map((e, i) => (
                  <div key={i} className="flex gap-3 px-5 py-2.5 text-[13px]">
                    <span className="text-muted w-14 shrink-0 tabular">{fmtDate(e.at)}</span>
                    <Icon name={e.kind === "document" ? "file" : e.kind === "alert" ? "alert" : e.kind === "message" ? "chat" : "dot"} className="size-3.5 text-faint mt-0.5 shrink-0" />
                    {e.kind === "document" ? <Link href={`/documents/${e.ref}`} className="hover:underline">{e.text}</Link> : <span className="min-w-0 break-words text-ink-2">{e.text}</span>}
                  </div>
                ))}
                {!events.length && <Empty>Nothing yet.</Empty>}
              </Card>
            </Section>
          )}
        </div>

        <aside>
          {!compact && canReplyTo(v.entity?.kind) && <div className="mb-8"><ConfirmLinkPanel matterId={m.id} counterparty={v.entity ? v.entity.display_name : null} /></div>}
          <Section title="Documents" right={v.checklist.length ? <Progress done={done} total={v.checklist.length} /> : undefined}>
            <Card className="divide-y divide-line">
              {v.checklist.map((c) => (
                <div key={c.doc} className="flex items-start gap-2.5 px-5 py-2.5 text-[13px]">
                  <span className={`mt-0.5 grid place-items-center size-4 rounded-full shrink-0 ${c.done ? "bg-ok text-white" : "border border-faint"}`}>{c.done && <Icon name="check" className="size-2.5" />}</span>
                  <span className="flex-1">
                    <span className={c.done ? "text-ink-2" : ""}>{c.label}</span> <span className="text-faint">{c.zh}</span>
                    {c.note && <span className="block text-[12.5px] text-muted">{c.note}</span>}
                  </span>
                  {!c.required && <Pill>optional</Pill>}
                </div>
              ))}
              {v.documents.map((d) => (
                <Link key={d.id} href={`/documents/${d.id}`} className="flex items-center gap-2.5 px-5 py-2.5 text-[13px] hover:bg-hover">
                  <Icon name="file" className="size-3.5 text-muted" /><span className="flex-1 truncate">{d.title}</span>
                  {d.expires_at && <span className="text-[12.5px] text-muted">exp. {fmtDate(d.expires_at, { year: true })}</span>}
                </Link>
              ))}
              {!v.checklist.length && !v.documents.length && <Empty icon="file">No documents yet.</Empty>}
            </Card>
          </Section>
          <Section title="Deadlines">
            <Card><TaskList tasks={taskViews(v.tasks)} showContext={false} /></Card>
          </Section>
          {v.entity && (
            <Section title="Counterparty">
              <Card>
                <Link href={`/contacts/${v.entity.id}`} className="block px-5 py-3.5 hover:bg-hover">
                  <div className="text-[14px] font-medium">{entityLabel(v.entity)}</div>
                  <div className="text-[12.5px] text-muted">{ENTITY_KINDS[v.entity.kind].label}{v.entity.legal_name_zh ? ` · ${v.entity.legal_name_zh}` : ""}</div>
                </Link>
              </Card>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
