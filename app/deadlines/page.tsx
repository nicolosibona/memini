import { appDb, CURRENT_USER, CURRENT_WS } from "@/lib/server";
import { userToken } from "@/lib/core/tokens";
import { calendarFeedUrl, calendarPageUrl, webcalUrl } from "@/lib/core/calendar";
import { CalendarCard } from "@/components/CalendarCard";
import { listTasks, ensureRecurring } from "@/lib/core/tasks";
import { taskViews } from "@/lib/views";
import { TaskList } from "@/components/Detail";
import { Card, Page, PageHeader, Section } from "@/components/ui";
import { addDays, today } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Deadlines" };

export default async function DeadlinesPage() {
  const db = await appDb();
  ensureRecurring(db, CURRENT_WS);
  const all = listTasks(db, CURRENT_WS, { status: "open" });
  const t0 = today(), week = addDays(t0, 7), month = addDays(t0, 31);
  const buckets = [
    { title: "Overdue", tasks: all.filter((t) => t.due_at && t.due_at < t0) },
    { title: "This week", tasks: all.filter((t) => t.due_at && t.due_at >= t0 && t.due_at <= week) },
    { title: "Next 30 days", tasks: all.filter((t) => t.due_at && t.due_at > week && t.due_at <= month) },
    { title: "Later", tasks: all.filter((t) => t.due_at && t.due_at > month) },
    { title: "No date", tasks: all.filter((t) => !t.due_at) },
  ].filter((b) => b.tasks.length);
  const done = listTasks(db, CURRENT_WS, { status: "done" }).slice(-8).reverse();
  const cal = userToken(db, CURRENT_USER, "calendar");

  return (
    <Page narrow>
      <PageHeader title="Deadlines" description="Promises from the other side, official deadlines, renewals from expiry dates and recurring payments — all in one list. Tick them off as they happen." />
      <div className="mb-8">
        <CalendarCard initial={{ feed: calendarFeedUrl(cal), webcal: webcalUrl(cal), page: calendarPageUrl(cal) }} />
      </div>
      {!buckets.length && <Card><TaskList tasks={[]} empty="Nothing open. Forward a contract, notice or message with a date and I'll track it." /></Card>}
      {buckets.map((b) => (
        <Section key={b.title} title={b.title} right={`${b.tasks.length}`}>
          <Card><TaskList tasks={taskViews(b.tasks)} /></Card>
        </Section>
      ))}
      {done.length > 0 && (
        <Section title="Recently done">
          <Card><TaskList tasks={taskViews(done)} /></Card>
        </Section>
      )}
    </Page>
  );
}
