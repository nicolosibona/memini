import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { listMatters, matterChecklist } from "@/lib/core/matters";
import { trustLight, openAlerts } from "@/lib/core/audit";
import { listTasks } from "@/lib/core/tasks";
import { getEntity, entityLabel } from "@/lib/core/entities";
import { MATTER_KINDS, type MatterKind } from "@/lib/core/domain";
import { Card, PageHeader, Section, Progress, TrustPill, Empty, fmtDate, relDay, Pill } from "@/components/ui";
import { Icon, MATTER_ICON } from "@/components/Icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Matters" };

export default async function MattersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "open" } = await searchParams;
  const db = await appDb();
  const profile = workspaceProfile(db);
  const all = listMatters(db, CURRENT_WS, { profile: profile.key });
  const shown = all.filter((m) => (status === "all" ? true : status === "done" ? ["done", "archived"].includes(m.status) : ["open", "waiting"].includes(m.status)));
  const byKind = new Map<MatterKind, typeof shown>();
  for (const m of shown) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
  const order = profile.def.matterKinds as readonly MatterKind[];
  const tabs = [["open", "Open"], ["done", "Done"], ["all", "All"]] as const;

  return (
    <div className="rise">
      <PageHeader
        title={profile.key === "china_business" ? "Matters" : "Purchases"}
        description="Every case you're working on — a purchase, a permit, a lease, your tax filings — with its documents, terms, checks and deadlines."
      />
      <div className="flex gap-1 mb-6 text-[13px]">
        {tabs.map(([k, l]) => (
          <Link key={k} href={`/matters?status=${k}`} className={`rounded-md px-2.5 py-1 ${status === k ? "bg-ink text-white" : "text-muted hover:bg-hover"}`}>
            {l} <span className="tabular opacity-70">{all.filter((m) => (k === "all" ? true : k === "done" ? ["done", "archived"].includes(m.status) : ["open", "waiting"].includes(m.status))).length}</span>
          </Link>
        ))}
      </div>
      {!shown.length && <Card><Empty icon="folder">Nothing here.</Empty></Card>}
      {order.filter((k) => byKind.has(k)).map((kind) => (
        <Section key={kind} title={<span className="inline-flex items-center gap-1.5"><Icon name={MATTER_ICON[kind]} className="size-3.5" />{MATTER_KINDS[kind].label}</span>} right={`${byKind.get(kind)!.length}`}>
          <Card className="divide-y divide-line">
            {byKind.get(kind)!.map((m) => {
              const e = m.entity_id ? getEntity(db, m.entity_id) : undefined;
              const cl = matterChecklist(db, m);
              const next = listTasks(db, CURRENT_WS, { matterId: m.id, status: "open" })[0];
              const alerts = openAlerts(db, { matterId: m.id });
              return (
                <Link key={m.id} href={`/matters/${m.id}`} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_160px_150px_110px] items-center gap-3 px-4 py-3 hover:bg-hover transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{m.title}</div>
                    <div className="text-xs text-muted truncate">{e ? entityLabel(e) : "—"}{alerts.length ? ` · ${alerts.length} alert${alerts.length > 1 ? "s" : ""}` : ""}</div>
                  </div>
                  <div className="hidden sm:block">{cl.length ? <Progress done={cl.filter((c) => c.done).length} total={cl.length} /> : <span className="text-xs text-faint">No checklist</span>}</div>
                  <div className="hidden sm:block text-xs">
                    {next?.due_at ? <><div className="truncate text-ink-2">{next.what}</div><div className={next.due_at < new Date().toISOString().slice(0, 10) ? "text-bad" : "text-muted"}>{fmtDate(next.due_at)} · {relDay(next.due_at)}</div></> : <span className="text-faint">No deadline</span>}
                  </div>
                  <div className="flex justify-end">{m.status === "open" || m.status === "waiting" ? <TrustPill trust={trustLight(db, { matterId: m.id })} /> : <Pill>{m.status}</Pill>}</div>
                </Link>
              );
            })}
          </Card>
        </Section>
      ))}
    </div>
  );
}
