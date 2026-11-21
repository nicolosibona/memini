import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { listMatters, matterChecklist } from "@/lib/core/matters";
import { trustLight, openAlerts } from "@/lib/core/audit";
import { listTasks } from "@/lib/core/tasks";
import { getEntity, entityLabel } from "@/lib/core/entities";
import { MATTER_KINDS, type MatterKind } from "@/lib/core/domain";
import { today } from "@/lib/db";
import { Card, Page, Progress, TrustPill, Empty, fmtDate, relDay, Pill } from "@/components/ui";
import { Icon, MATTER_ICON } from "@/components/Icon";
import { HubHeader } from "@/components/shell/Hub";
import { hubCounts } from "@/components/shell/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work" };

export default async function MattersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "open" } = await searchParams;
  const db = await appDb();
  const profile = workspaceProfile(db);
  const business = profile.key === "china_business";
  const all = listMatters(db, CURRENT_WS, { profile: profile.key });
  const isOpen = (s: string) => ["open", "waiting"].includes(s);
  const isDone = (s: string) => ["done", "archived"].includes(s);
  const shown = all.filter((m) => (status === "all" ? true : status === "done" ? isDone(m.status) : isOpen(m.status)));
  const byKind = new Map<MatterKind, typeof shown>();
  for (const m of shown) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
  const order = profile.def.matterKinds as readonly MatterKind[];
  const tabs = [["open", "Open"], ["done", "Done"], ["all", "All"]] as const;
  const t0 = today();

  return (
    <Page>
      <HubHeader
        hub="work" tab="matters" counts={hubCounts(db)}
        lead={business ? "Every case in one place." : "Every purchase in one place."}
        rest="Open one without losing the list."
        note="Documents, terms, checks and deadlines for each, kept together."
      />
      <div className="inline-flex gap-1 mb-6 p-1 rounded-full border border-line bg-card/70 text-[13px]">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/matters?status=${k}`} replace aria-current={status === k ? "true" : undefined}
            className={`press rounded-full px-4 h-8 inline-flex items-center gap-1.5 ${status === k ? "bg-ink text-white" : "text-muted hover:text-ink hover:bg-hover"}`}>
            {l} <span className="tabular opacity-60">{all.filter((m) => (k === "all" ? true : k === "done" ? isDone(m.status) : isOpen(m.status))).length}</span>
          </Link>
        ))}
      </div>
      {!shown.length && <Card><Empty icon="folder">Nothing here yet. Forward a quote, contract or notice and it opens a {business ? "matter" : "purchase"} by itself.</Empty></Card>}
      <div className="space-y-6">
        {order.filter((k) => byKind.has(k)).map((kind) => (
          <Card key={kind}>
            <div className="flex items-center justify-between px-6 pt-5 pb-3">
              <h2 className="text-[15px] font-medium inline-flex items-center gap-2"><Icon name={MATTER_ICON[kind]} className="size-4 text-faint" />{MATTER_KINDS[kind].label}</h2>
              <span className="text-[12.5px] text-faint tabular">{byKind.get(kind)!.length}</span>
            </div>
            <div className="divide-y divide-line">
              {byKind.get(kind)!.map((m) => {
                const e = m.entity_id ? getEntity(db, m.entity_id) : undefined;
                const cl = matterChecklist(db, m);
                const next = listTasks(db, CURRENT_WS, { matterId: m.id, status: "open" })[0];
                const alerts = openAlerts(db, { matterId: m.id });
                return (
                  <Link key={m.id} href={`/matters/${m.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_150px_170px_110px] items-center gap-x-4 gap-y-1 px-6 py-4 hover:bg-hover transition-colors last:rounded-b-3xl">
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-medium truncate">{m.title}</div>
                      <div className="text-[12.5px] text-muted truncate">{e ? entityLabel(e) : "No contact yet"}{alerts.length ? ` · ${alerts.length} alert${alerts.length > 1 ? "s" : ""}` : ""}</div>
                    </div>
                    <div className="hidden md:block">{cl.length ? <Progress done={cl.filter((c) => c.done).length} total={cl.length} /> : <span className="text-[12.5px] text-faint">No checklist</span>}</div>
                    <div className="hidden md:block text-[12.5px] min-w-0">
                      {next?.due_at ? <><div className="truncate text-ink-2">{next.what}</div><div className={next.due_at < t0 ? "text-bad" : "text-muted"}>{fmtDate(next.due_at)} · {relDay(next.due_at)}</div></> : <span className="text-faint">No deadline</span>}
                    </div>
                    <div className="flex justify-end">{isOpen(m.status) ? <TrustPill trust={trustLight(db, { matterId: m.id })} /> : <Pill>{m.status}</Pill>}</div>
                  </Link>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </Page>
  );
}
