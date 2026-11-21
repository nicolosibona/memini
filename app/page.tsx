import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { openAlerts } from "@/lib/core/audit";
import { listTasks, ensureRecurring } from "@/lib/core/tasks";
import { originalFileName } from "@/lib/core/extract";
import { wecomConfigured } from "@/lib/channels/wecom";
import { HomeChat } from "@/components/HomeChat";
import { Card, Dot, ago, fmtDate, relDay } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { TZ, today } from "@/lib/db";

export const dynamic = "force-dynamic";

type Activity = { key: string; at: string; title: string; sub: string; href: string | null; source: "wechat" | "web" | "doc" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 5 ? "Working late." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

export default async function HomePage() {
  const db = await appDb();
  ensureRecurring(db, CURRENT_WS);
  const profile = workspaceProfile(db);
  const business = profile.key === "china_business";
  const t0 = today();
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

  const alerts = openAlerts(db, { workspaceId: CURRENT_WS });
  const tasks = listTasks(db, CURRENT_WS, { status: "open", withinDays: 21 });
  const overdue = tasks.filter((t) => t.due_at! < t0).length;
  const inbox = n(`SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ? AND status = 'pending' AND intent = 'content'`, CURRENT_WS);
  const mem = {
    contacts: n(`SELECT COUNT(*) AS n FROM entities WHERE workspace_id = ? AND kind NOT LIKE 'self%'`, CURRENT_WS),
    matters: n(`SELECT COUNT(*) AS n FROM matters WHERE workspace_id = ? AND status IN ('open', 'waiting')`, CURRENT_WS),
    documents: n(`SELECT COUNT(*) AS n FROM documents WHERE workspace_id = ?`, CURRENT_WS),
    facts: n(`SELECT COUNT(*) AS n FROM facts WHERE workspace_id = ? AND status NOT IN ('superseded', 'rejected')`, CURRENT_WS),
  };
  const linked = wecomConfigured() && n(`SELECT COUNT(*) AS n FROM users WHERE wecom_external_userid IS NOT NULL`) > 0;

  const titleOf = (id: string | null) => (id ? (db.prepare(`SELECT title FROM matters WHERE id = ?`).get(id) as { title: string } | undefined)?.title ?? null : null);
  const nameOf = (id: string | null) => (id ? (db.prepare(`SELECT display_name FROM entities WHERE id = ?`).get(id) as { display_name: string } | undefined)?.display_name ?? null : null);

  const docs = db.prepare(`SELECT id, title, created_at AS at, matter_id, entity_id, message_id FROM documents WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 6`).all(CURRENT_WS) as { id: string; title: string; at: string; matter_id: string | null; entity_id: string | null; message_id: string | null }[];
  const msgs = db.prepare(
    `SELECT id, channel, kind, text_original, file_path, original_author, received_at AS at, matter_id, entity_id, status FROM messages
     WHERE workspace_id = ? AND direction = 'in' AND intent = 'content' AND kind IN ('text', 'voice', 'merged') ORDER BY received_at DESC LIMIT 6`,
  ).all(CURRENT_WS) as { id: string; channel: string; kind: string; text_original: string | null; file_path: string | null; original_author: string | null; at: string; matter_id: string | null; entity_id: string | null; status: string }[];
  const docChannel = (mid: string | null) => (mid ? (db.prepare(`SELECT channel FROM messages WHERE id = ?`).get(mid) as { channel: string } | undefined)?.channel : undefined);
  const activity: Activity[] = [
    ...docs.map((d): Activity => ({
      key: d.id, at: d.at, title: d.title, sub: titleOf(d.matter_id) ?? nameOf(d.entity_id) ?? "Waiting to be filed",
      href: `/documents/${d.id}`, source: docChannel(d.message_id) === "wecom" ? "wechat" : "doc",
    })),
    ...msgs.map((m): Activity => ({
      key: m.id, at: m.at, title: (m.text_original ?? (m.file_path ? originalFileName(m.file_path) : "Message")).replace(/\s+/g, " ").slice(0, 90),
      sub: m.status === "pending" ? "Waiting to be filed" : [m.original_author, titleOf(m.matter_id) ?? nameOf(m.entity_id)].filter(Boolean).join(" · ") || "Message",
      href: m.status === "pending" ? "/inbox" : m.matter_id ? `/matters/${m.matter_id}` : m.entity_id ? `/contacts/${m.entity_id}` : null,
      source: m.channel === "wecom" ? "wechat" : "web",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  const date = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
  const needs = alerts.length + overdue + inbox;
  const suggestions = business
    ? ["What's due this month?", "Any problems with my lease before I pay?", "Is Seller 1 or Seller 2 the better deal?", "What did Lisa promise me?"]
    : ["Is Seller 1 or Seller 2 the better deal?", "Any open issues with ABC before I pay?", "What did Lisa promise me?", "Draft a follow-up in Chinese to Seller 1"];

  return (
    <HomeChat
      eyebrow={
        <>
          <span>{date}</span>
          <span className="text-faint">·</span>
          {linked ? <span className="inline-flex items-center gap-1.5 text-wechat-dark"><Dot tone="wechat" live />WeChat live</span>
            : <Link href="/wechat" className="inline-flex items-center gap-1.5 hover:text-ink"><Dot tone="neutral" />Connect WeChat</Link>}
        </>
      }
      greeting={greeting()}
      prompt="Ask anything, paste a chat, or drop a document…"
      suggestions={suggestions}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="text-[15px] font-semibold">{needs ? `${needs} thing${needs > 1 ? "s" : ""} need${needs > 1 ? "" : "s"} you` : "All clear for now"}</h2>
        <p className="text-[13px] text-muted tabular">
          In memory: {mem.contacts} {business ? "contacts" : "suppliers"} · {mem.matters} open {business ? "matters" : "purchases"} · {mem.documents} documents · {mem.facts} facts
        </p>
      </div>

      {inbox > 0 && (
        <Link href="/inbox" className="lift mb-4 flex items-center gap-4 rounded-2xl border border-line bg-card px-5 py-4">
          <span className="grid place-items-center size-10 rounded-full bg-warn-soft text-warn shrink-0"><Icon name="inbox" className="size-5" /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-[15px] font-medium">{inbox} item{inbox > 1 ? "s" : ""} waiting to be filed</span>
            <span className="block text-[13.5px] text-muted">I couldn&apos;t tell for sure who {inbox > 1 ? "they're" : "it's"} from. Pick the contact and I&apos;ll run the checks.</span>
          </span>
          <Icon name="arrow" className="size-4 text-muted" />
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex flex-col">
          <CardHead title="Needs attention" href="/matters" count={alerts.length} />
          <div className="divide-y divide-line flex-1">
            {alerts.slice(0, 4).map((a) => (
              <Link key={a.id} href={a.matter_id ? `/matters/${a.matter_id}` : a.entity_id ? `/contacts/${a.entity_id}` : "/"} className="flex gap-3 px-5 py-3 hover:bg-hover transition-colors">
                <span className={`mt-[7px] size-2 rounded-full shrink-0 ${a.severity === "red" ? "bg-bad" : a.severity === "amber" ? "bg-warn" : "bg-info"}`} />
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug line-clamp-2">{a.title}</span>
                  <span className="block text-[12.5px] text-muted truncate mt-0.5">{titleOf(a.matter_id) ?? nameOf(a.entity_id) ?? ""}</span>
                </span>
              </Link>
            ))}
            {!alerts.length && <Quiet icon="check">No red flags. I&apos;ll tell you the moment something doesn&apos;t add up.</Quiet>}
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Coming up" href="/deadlines" count={tasks.length} />
          <div className="divide-y divide-line flex-1">
            {tasks.slice(0, 4).map((t) => {
              const late = t.due_at! < t0;
              return (
                <Link key={t.id} href={t.matter_id ? `/matters/${t.matter_id}` : "/deadlines"} className="flex items-start gap-3 px-5 py-3 hover:bg-hover transition-colors">
                  <span className={`w-12 shrink-0 text-center rounded-lg py-1 ${late ? "bg-bad-soft text-bad" : "bg-line-2 text-ink-2"}`}>
                    <span className="block text-[11px] font-medium uppercase leading-none mt-0.5">{fmtDate(t.due_at).split(" ")[0]}</span>
                    <span className="block text-[17px] font-semibold tabular leading-tight">{fmtDate(t.due_at).split(" ")[1]}</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14px] leading-snug line-clamp-2">{t.what}</span>
                    <span className={`block text-[12.5px] mt-0.5 ${late ? "text-bad" : "text-muted"}`}>{relDay(t.due_at)}{t.matter_title ? ` · ${t.matter_title}` : ""}</span>
                  </span>
                </Link>
              );
            })}
            {!tasks.length && <Quiet icon="calendar">Nothing due in the next three weeks.</Quiet>}
          </div>
        </Card>

        <Card className="flex flex-col">
          <CardHead title="Just arrived" href="/documents" />
          <div className="divide-y divide-line flex-1">
            {activity.map((a) => {
              const fresh = Date.now() - +new Date(a.at) < 120000;
              const inner = (
                <>
                  <span className={`grid place-items-center size-8 rounded-full shrink-0 ${a.source === "wechat" ? "bg-wechat-soft text-wechat-dark" : "bg-line-2 text-ink-2"}`}>
                    <Icon name={a.source === "wechat" ? "wechat" : a.source === "doc" ? "file" : "chat"} className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] leading-snug truncate">{a.title}</span>
                    <span className="block text-[12.5px] text-muted truncate mt-0.5">{a.sub}</span>
                  </span>
                  <span className="text-[12px] text-faint whitespace-nowrap tabular">{ago(a.at)}</span>
                </>
              );
              const cls = `flex items-center gap-3 px-5 py-3 ${fresh ? "flash" : ""}`;
              return a.href ? <Link key={a.key} href={a.href} className={`${cls} hover:bg-hover transition-colors`}>{inner}</Link> : <div key={a.key} className={cls}>{inner}</div>;
            })}
            {!activity.length && <Quiet icon="forward">Forward something on WeChat or drop a file above. It shows up here.</Quiet>}
          </div>
        </Card>
      </div>
    </HomeChat>
  );
}

function CardHead({ title, href, count }: { title: string; href: string; count?: number }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-3">
      <h3 className="text-[14px] font-semibold flex items-center gap-2">{title}{count ? <span className="text-[12.5px] font-medium text-muted tabular">{count}</span> : null}</h3>
      <Link href={href} className="group inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink">All<Icon name="arrow" className="size-3.5 transition-transform group-hover:translate-x-0.5" /></Link>
    </div>
  );
}

function Quiet({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-8 text-center text-[13.5px] text-muted">
      <Icon name={icon} className="size-5 text-faint mx-auto mb-2" />
      {children}
    </div>
  );
}
