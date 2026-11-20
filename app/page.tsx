import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { openAlerts } from "@/lib/core/audit";
import { listMatters, matterChecklist } from "@/lib/core/matters";
import { listTasks, ensureRecurring } from "@/lib/core/tasks";
import { getEntity } from "@/lib/core/entities";
import { MATTER_KINDS } from "@/lib/core/domain";
import { trustLight } from "@/lib/core/audit";
import { alertViews, taskViews } from "@/lib/views";
import { AlertList, TaskList } from "@/components/Detail";
import { Card, PageHeader, Section, Stat, Progress, Dot, Button, Empty } from "@/components/ui";
import { Icon, MATTER_ICON } from "@/components/Icon";
import { today } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const db = await appDb();
  ensureRecurring(db, CURRENT_WS);
  const profile = workspaceProfile(db);
  const alerts = openAlerts(db, { workspaceId: CURRENT_WS });
  const matters = listMatters(db, CURRENT_WS, { profile: profile.key, status: ["open", "waiting"] });
  const titleOf = (id: string) => (db.prepare(`SELECT title FROM matters WHERE id = ?`).get(id) as { title: string } | undefined)?.title ?? null;
  const tasks = listTasks(db, CURRENT_WS, { status: "open", withinDays: 14 });
  const inbox = (db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ? AND status = 'pending' AND intent = 'content'`).get(CURRENT_WS) as { n: number }).n;
  const overdue = tasks.filter((t) => t.due_at! < today()).length;
  const reds = alerts.filter((a) => a.severity === "red").length;
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="rise">
      <PageHeader
        eyebrow={date}
        title="Today"
        description={profile.key === "china_business" ? "What needs you across suppliers, paperwork and deadlines." : "What needs you across your suppliers and purchases."}
        actions={<><Button href="/ask" variant="secondary" icon="chat">Ask</Button><Button href="/upload" icon="upload">Add documents</Button></>}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Stat label="Red flags" value={reds} tone={reds ? "bad" : "ok"} href="#attention" />
        <Stat label="Overdue" value={overdue} tone={overdue ? "bad" : "neutral"} href="/deadlines" />
        <Stat label="Due in 14 days" value={tasks.length - overdue} href="/deadlines" />
        <Stat label="To file" value={inbox} tone={inbox ? "warn" : "neutral"} href="/inbox" />
      </div>

      {inbox > 0 && (
        <Link href="/inbox" className="flex items-center gap-3 mb-8 rounded-[10px] border border-warn/30 bg-warn-soft px-4 py-3 text-sm hover:brightness-[0.98]">
          <Icon name="inbox" className="size-4 text-warn" />
          <span className="flex-1"><b className="font-medium">{inbox} item{inbox > 1 ? "s" : ""} waiting to be filed.</b> I couldn&apos;t tell for sure who {inbox > 1 ? "they're" : "it's"} from — pick one and I&apos;ll run the checks.</span>
          <Icon name="arrow" className="size-4 text-warn" />
        </Link>
      )}

      <div className="grid gap-x-8 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <Section title="Needs attention" right={`${alerts.length} open`}>
            <div id="attention" />
            <Card><AlertList alerts={alertViews(db, alerts.slice(0, 8), { matterTitle: titleOf })} showContext /></Card>
          </Section>
          <Section title="Coming up" right={<Link href="/deadlines" className="hover:text-ink">All deadlines →</Link>}>
            <Card><TaskList tasks={taskViews(tasks.slice(0, 8))} empty="Nothing due in the next two weeks." /></Card>
          </Section>
        </div>

        <div>
          <Section title={profile.key === "china_business" ? "Open matters" : "Open purchases"} right={<Link href="/matters" className="hover:text-ink">All →</Link>}>
            <Card className="divide-y divide-line">
              {matters.slice(0, 9).map((m) => {
                const e = m.entity_id ? getEntity(db, m.entity_id) : undefined;
                const trust = trustLight(db, { matterId: m.id });
                const cl = matterChecklist(db, m);
                return (
                  <Link key={m.id} href={`/matters/${m.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover transition-colors">
                    <span className="grid place-items-center size-8 rounded-md bg-line-2 text-ink-2 shrink-0"><Icon name={MATTER_ICON[m.kind]} className="size-4" /></span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{m.title}</span>
                      <span className="block text-xs text-muted truncate">{e && e.kind !== "self_person" ? e.label : MATTER_KINDS[m.kind].label}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <Dot tone={trust === "red" ? "bad" : trust === "amber" ? "warn" : trust === "green" ? "ok" : "neutral"} />
                      {cl.length > 0 && <Progress done={cl.filter((c) => c.done).length} total={cl.length} />}
                    </span>
                  </Link>
                );
              })}
              {!matters.length && <Empty icon="folder">No open matters. Forward something to get started.</Empty>}
            </Card>
          </Section>
        </div>
      </div>
    </div>
  );
}
