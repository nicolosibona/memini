import { appDb } from "@/lib/server";
import { inboxData } from "@/components/shell/data";
import { InboxList } from "@/components/InboxList";
import { Page, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "To file" };

export default async function InboxPage() {
  const db = await appDb();
  const { items, contacts, kinds } = inboxData(db);
  return (
    <Page narrow>
      <PageHeader
        title="To file."
        rest="Nothing is guessed."
        description="I never guess who something is from. These had no name or code I could match for sure. Pick the contact and I'll file it, check it and track its dates."
      />
      <InboxList items={items} contacts={contacts} kinds={kinds} />
    </Page>
  );
}
