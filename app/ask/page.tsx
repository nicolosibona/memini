import { AskChat } from "@/components/AskChat";
import { PageHeader } from "@/components/ui";
import { appDb, workspaceProfile } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask" };

export default async function AskPage() {
  const profile = workspaceProfile(await appDb());
  const examples = profile.key === "china_business"
    ? ["What's due this month?", "Any problems with my lease before I pay the deposit?", "Is Seller 1 or Seller 2 the better deal?", "What did Lisa promise me?", "Write a polite message to my landlord about the rent difference"]
    : ["Is Seller 1 or Seller 2 the better deal?", "Any open issues with ABC before I pay the deposit?", "What did Lisa promise me?", "Write me a polite follow-up in Chinese about the sample to Seller 1"];
  return (
    <div className="rise max-w-3xl">
      <PageHeader title="Ask" description="Same assistant as on WeChat. It only answers from what you've forwarded, and says where every number comes from." />
      <AskChat examples={examples} />
    </div>
  );
}
