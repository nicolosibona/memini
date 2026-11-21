import Link from "next/link";
import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { openAlerts } from "@/lib/core/audit";
import { listTasks, ensureRecurring } from "@/lib/core/tasks";
import { comparisons } from "@/lib/core/memory";
import { originalFileName } from "@/lib/core/extract";
import { wecomConfigured } from "@/lib/channels/wecom";
import { TZ, today } from "@/lib/db";
import { alertViews, taskViews } from "@/lib/views";
import { inboxData } from "@/components/shell/data";
import { HomeStage } from "@/components/home/HomeStage";
import { AttentionList } from "@/components/home/AttentionList";
import { InboxList } from "@/components/InboxList";
import { TaskList } from "@/components/Detail";
import { AmbientField } from "@/components/ambient/AmbientField";
import { Mist, Silk } from "@/components/ambient/Stage";
import { Card, CardHead, BracketLink, Dot, Empty, ago } from "@/components/ui";
import { Icon } from "@/components/Icon";

export const dynamic = "force-dynamic";

type Activity = { key: string; at: string; title: string; sub: string; href: string | null; source: "wechat" | "web" | "doc" };
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", hour12: false }).format(new Date()));
  return h < 5 ? "Working late." : h < 12 ? "Good morning." : h < 18 ? "Good afternoon." : "Good evening.";
}

export default async function TodayPage() {
  const db = await appDb();
  ensureRecurring(db, CURRENT_WS);
  const profile = workspaceProfile(db);
  const business = profile.key === "china_business";
  const electronics = profile.key === "electronics";
  const t0 = today();
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;

  const alerts = openAlerts(db, { workspaceId: CURRENT_WS });
  const tasks = listTasks(db, CURRENT_WS, { status: "open", withinDays: 21 });
  const overdue = tasks.filter((t) => t.due_at! < t0).length;
  const { items: pending, contacts, kinds } = inboxData(db);
  const mem = {
    contacts: n(`SELECT COUNT(*) AS n FROM entities WHERE workspace_id = ? AND kind NOT LIKE 'self%'`, CURRENT_WS),
    matters: n(`SELECT COUNT(*) AS n FROM matters WHERE workspace_id = ? AND status IN ('open', 'waiting')`, CURRENT_WS),
    documents: n(`SELECT COUNT(*) AS n FROM documents WHERE workspace_id = ?`, CURRENT_WS),
    facts: n(`SELECT COUNT(*) AS n FROM facts WHERE workspace_id = ? AND status NOT IN ('superseded', 'rejected')`, CURRENT_WS),
  };
  const linked = wecomConfigured() && n(`SELECT COUNT(*) AS n FROM users WHERE wecom_external_userid IS NOT NULL`) > 0;

  const titleOf = (id: string | null) => (id ? (db.prepare(`SELECT title FROM matters WHERE id = ?`).get(id) as { title: string } | undefined)?.title ?? null : null);
  const nameOf = (id: string | null) => (id ? (db.prepare(`SELECT display_name FROM entities WHERE id = ?`).get(id) as { display_name: string } | undefined)?.display_name ?? null : null);

  const docs = db.prepare(`SELECT id, title, created_at AS at, matter_id, entity_id, message_id, file_path FROM documents WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 6`).all(CURRENT_WS) as { id: string; title: string; at: string; matter_id: string | null; entity_id: string | null; message_id: string | null; file_path: string | null }[];
  const msgs = db.prepare(
    `SELECT id, channel, kind, text_original, file_path, original_author, received_at AS at, matter_id, entity_id, status FROM messages
     WHERE workspace_id = ? AND direction = 'in' AND intent = 'content' AND kind IN ('text', 'voice', 'merged') ORDER BY received_at DESC LIMIT 6`,
  ).all(CURRENT_WS) as { id: string; channel: string; kind: string; text_original: string | null; file_path: string | null; original_author: string | null; at: string; matter_id: string | null; entity_id: string | null; status: string }[];
  const docChannel = (mid: string | null) => (mid ? (db.prepare(`SELECT channel FROM messages WHERE id = ?`).get(mid) as { channel: string } | undefined)?.channel : undefined);
  const activity: Activity[] = [
    ...docs.map((d): Activity => ({
      key: d.id, at: d.at, title: d.title, sub: titleOf(d.matter_id) ?? nameOf(d.entity_id) ?? "Waiting to be filed",
      href: d.file_path ? `/documents/${d.id}` : d.matter_id ? `/matters/${d.matter_id}` : "/documents", source: docChannel(d.message_id) === "wecom" ? "wechat" : "doc",
    })),
    ...msgs.map((m): Activity => ({
      key: m.id, at: m.at, title: (m.text_original ?? (m.file_path ? originalFileName(m.file_path) : "Message")).replace(/\s+/g, " ").slice(0, 90),
      sub: m.status === "pending" ? "Waiting to be filed" : [m.original_author, titleOf(m.matter_id) ?? nameOf(m.entity_id)].filter(Boolean).join(" · ") || "Message",
      href: m.status === "pending" ? "/inbox" : m.matter_id ? `/matters/${m.matter_id}` : m.entity_id ? `/contacts/${m.entity_id}` : null,
      source: m.channel === "wecom" ? "wechat" : "web",
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);

  const quotes = comparisons(db, CURRENT_WS).filter((g) => g.rows.length > 1).slice(0, 2).map((g) => {
    const priced = g.rows.map((r) => ({ name: r.name, v: Number((r.terms.unit_price?.value ?? "").replace(/[^\d.]/g, "")), label: r.terms.unit_price?.value })).filter((r) => r.v > 0);
    const best = priced.sort((a, b) => a.v - b.v)[0];
    return { key: g.key, subject: g.subject, n: g.rows.length, red: g.rows.reduce((s, r) => s + r.open_red, 0), best };
  });

  const date = new Date().toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" });
  const needs = alerts.length + overdue + pending.length;
  const rest = needs ? `${WORDS[Math.min(needs, 9)] ?? needs} thing${needs > 1 ? "s" : ""} need${needs > 1 ? "" : "s"} you.` : "Everything is in order.";
  const open = alertViews(db, alerts.slice(0, 4), { matterTitle: titleOf, entityName: nameOf });

  return (
    <HomeStage
      business={electronics ? "electronics" : business}
      lead={greeting()}
      rest={rest}
      eyebrow={
        <>
          {electronics && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 bg-card/70 px-2.5 h-6 text-[12px] text-ink-2">
                <span className="size-1.5 rounded-full bg-brand" />Spec-tuned engineering model · EN ⇄ 中文
              </span>
              <span className="text-faint">·</span>
            </>
          )}
          <span>{date}</span>
          <span className="text-faint">·</span>
          {linked ? <span className="inline-flex items-center gap-1.5 text-wechat-dark"><Dot tone="wechat" live />WeChat live</span>
            : <Link href="/wechat" className="inline-flex items-center gap-1.5 hover:text-ink"><Dot tone="neutral" />Connect WeChat</Link>}
        </>
      }
    >
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-6">
          {electronics && (
            <Card className="@3xl:col-span-6 p-6 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h3 className="display text-[28px] sm:text-[34px] leading-tight">
                  <span className="text-ink">Electronic parts, verified.</span> <span className="text-stone">In English and 中文.</span>
                </h3>
                <BracketLink href="/specs">Spec checks</BracketLink>
              </div>
              <ol className="mt-6 grid gap-4 sm:grid-cols-3">
                {[
                  ["01", "Translate without slips", "Our model is trained on engineering datasheets. Every number, unit, tolerance and temperature rating is kept exact: μF, V, ℃, ±%."],
                  ["02", "Check and negotiate", "Each parameter is compared with your spec and every swap is flagged. Price, MOQ and lead time are negotiated in Chinese for you."],
                  ["03", "Supplier confirms on WeChat", "The bot sends the supplier a spreadsheet in English or your language and in Chinese, side by side. They confirm it line by line."],
                ].map(([n, t, d]) => (
                  <li key={n} className="rounded-2xl border border-line bg-ivory px-5 py-4">
                    <div className="mono text-[12px] text-brand">{n}</div>
                    <div className="mt-1.5 text-[15px] font-medium">{t}</div>
                    <p className="mt-1 text-[13.5px] text-muted leading-relaxed">{d}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {pending.length > 0 && (
            <Card className="@3xl:col-span-6" tone="ivory">
              <CardHead title="Waiting to be filed" count={pending.length} action={<BracketLink href="/inbox">Open</BracketLink>} />
              <p className="px-6 -mt-1 pb-3 text-[13.5px] text-muted max-w-[62ch]">I couldn&apos;t tell for sure who {pending.length > 1 ? "these are" : "this is"} from. Pick the contact and I&apos;ll file {pending.length > 1 ? "them" : "it"}, run the checks and track the dates.</p>
              <div className="px-3 pb-3"><InboxList items={pending.slice(0, 3)} contacts={contacts} kinds={kinds} compact /></div>
              {pending.length > 3 && <div className="px-6 pb-5"><BracketLink href="/inbox">{pending.length - 3} more</BracketLink></div>}
            </Card>
          )}

          <Card className="@3xl:col-span-4 flex flex-col">
            <CardHead title="Needs you" count={alerts.length || ""} action={<BracketLink href="/matters">Matters</BracketLink>} />
            {open.length ? <AttentionList alerts={open} /> : <Empty icon="check">No red flags. I&apos;ll tell you the moment something doesn&apos;t add up.</Empty>}
            {alerts.length > open.length && <div className="px-6 py-3 border-t border-line text-[13px] text-muted">{alerts.length - open.length} more in <Link href="/matters" className="underline underline-offset-2 hover:text-ink">Matters</Link></div>}
          </Card>

          <Card tone="night" className="@3xl:col-span-2 @3xl:row-span-2 relative overflow-hidden flex flex-col min-h-[320px]">
            <Mist tone="night" />
            <Silk tone="night" />
            <AmbientField palette="night" />
            <div className="relative flex flex-col flex-1">
              <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
                <h3 className="text-[15px] font-medium flex items-center gap-2">Just arrived {linked && <span className="inline-flex items-center gap-1.5 text-[12px] font-normal text-[#7be0a8]"><span className="size-1.5 rounded-full bg-wechat live-dot" />live</span>}</h3>
                <Link href="/wechat" className="text-[12.5px] text-white/60 hover:text-white">WeChat</Link>
              </div>
              <div className="flex-1">
                {activity.map((a) => {
                  const fresh = Date.now() - +new Date(a.at) < 120000;
                  const inner = (
                    <>
                      <span className={`grid place-items-center size-8 rounded-full shrink-0 ${a.source === "wechat" ? "bg-wechat/20 text-[#7be0a8]" : "bg-white/10 text-white/70"}`}>
                        <Icon name={a.source === "wechat" ? "wechat" : a.source === "doc" ? "file" : "chat"} className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13.5px] leading-snug truncate">{a.title}</span>
                        <span className="block text-[12px] text-white/55 truncate mt-0.5">{a.sub}</span>
                      </span>
                      <span className="text-[11.5px] text-white/45 whitespace-nowrap tabular">{ago(a.at)}</span>
                    </>
                  );
                  const cls = `flex items-center gap-3 px-6 py-3 ${fresh ? "bg-white/[0.07]" : ""}`;
                  return a.href ? <Link key={a.key} href={a.href} className={`${cls} hover:bg-white/[0.06] transition-colors`}>{inner}</Link> : <div key={a.key} className={cls}>{inner}</div>;
                })}
                {!activity.length && (
                  <div className="px-6 py-10 text-center text-[13.5px] text-white/65">
                    <Icon name="forward" className="size-5 mx-auto mb-2 text-white/45" />
                    Forward something on WeChat or drop a file in the box above. It shows up here.
                  </div>
                )}
              </div>
              {!linked && (
                <Link href="/wechat" className="mx-5 mb-5 mt-2 press inline-flex items-center justify-center gap-2 h-10 rounded-full bg-white text-ink text-[13.5px] font-medium hover:bg-white/90">
                  <Icon name="qr" className="size-4" />Connect WeChat
                </Link>
              )}
            </div>
          </Card>

          <Card className="@3xl:col-span-4">
            <CardHead title="Coming up" count={tasks.length || ""} action={<BracketLink href="/deadlines">Deadlines</BracketLink>} />
            <TaskList tasks={taskViews(tasks.slice(0, 5))} empty="Nothing due in the next three weeks." />
            {tasks.length > 5 && <div className="px-6 py-3 border-t border-line text-[13px] text-muted">{tasks.length - 5} more in <Link href="/deadlines" className="underline underline-offset-2 hover:text-ink">Deadlines</Link></div>}
          </Card>

          <Card tone="ivory" className="@3xl:col-span-3 p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[15px] font-medium">{electronics ? "Quotes & negotiation" : "Quotes"}</h3>
              <BracketLink href={quotes.length ? "/compare" : "/outreach"}>{quotes.length ? "Compare" : "Start outreach"}</BracketLink>
            </div>
            {quotes.length ? (
              <div className="mt-4 space-y-3">
                {quotes.map((q) => (
                  <Link key={q.key} href={`/compare#${encodeURIComponent(q.key)}`} className="block rounded-2xl bg-card border border-line px-4 py-3 hover:border-ink/25 transition-colors">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-medium truncate">{q.subject}</span>
                      <span className="text-[12px] text-faint tabular shrink-0">{q.n} quotes</span>
                    </div>
                    <div className="text-[13px] text-muted mt-0.5">
                      {q.best ? <>Lowest <span className="mono text-ink">{q.best.label}</span> from {q.best.name}</> : "No prices read yet"}
                      {q.red ? <span className="text-bad"> · {q.red} red flag{q.red > 1 ? "s" : ""}</span> : null}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[13.5px] text-muted leading-relaxed">{electronics ? "Ask 5 to 10 factories for the same part at once. Memini negotiates price, MOQ and lead time in Chinese, and only verified quotes land in Compare." : "Ask 5 to 10 factories for a price at once. Replies are filtered automatically and only the verified quotes land in Compare."}</p>
            )}
          </Card>

          <Card tone="ivory" className="@3xl:col-span-3 p-6">
            <h3 className="text-[15px] font-medium">In memory</h3>
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4">
              {[
                [business ? "Contacts" : "Suppliers", mem.contacts, "/contacts"],
                [business ? "Open matters" : "Open purchases", mem.matters, "/matters"],
                ["Documents", mem.documents, "/documents"],
                ["Facts on file", mem.facts, "/documents"],
              ].map(([l, v, href]) => (
                <Link key={l as string} href={href as string} className="group block">
                  <dd className="display text-[38px] leading-none tabular group-hover:text-brand transition-colors">{v}</dd>
                  <dt className="text-[12.5px] text-muted mt-1.5">{l}</dt>
                </Link>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </HomeStage>
  );
}
