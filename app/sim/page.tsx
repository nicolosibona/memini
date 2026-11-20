import { Simulator } from "@/components/Simulator";
import { DEMO_FILES, DEMO_TEXTS } from "@/data/demo/fixtures";
import { provider } from "@/lib/adapters/llm";
import { PageHeader, Pill } from "@/components/ui";
import { appDb, workspaceProfile } from "@/lib/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "WeChat simulator" };

export default async function SimPage() {
  const profile = workspaceProfile(await appDb());
  return (
    <div className="rise">
      <PageHeader
        title="WeChat simulator"
        description="The same core as the real 微信客服 bot: forward messages, documents and merged chats; menus appear as tappable rows."
        actions={<Pill tone={provider === "mock" ? "warn" : "ok"}>AI: {provider === "mock" ? "not connected (rules + saved answers)" : provider}</Pill>}
      />
      <Simulator demoFiles={DEMO_FILES.map((d) => ({ ...d }))} demoTexts={{ ...DEMO_TEXTS }} business={profile.key === "china_business"} />
    </div>
  );
}
