import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { provider, modelFor } from "@/lib/adapters/llm";
import { wecomConfigured } from "@/lib/channels/wecom";
import { PROFILES } from "@/lib/core/domain";
import { Card, Page, PageHeader, Section, Pill } from "@/components/ui";
import { ProfileForm, DemoReset } from "@/components/SettingsActions";
import { Icon } from "@/components/Icon";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const db = await appDb();
  const ws = db.prepare(`SELECT own_names FROM workspaces WHERE id = ?`).get(CURRENT_WS) as { own_names: string };
  const profile = workspaceProfile(db);
  const spend = db.prepare(`SELECT step, model, source, COUNT(*) AS n, SUM(est_cost_usd) AS usd, AVG(ms) AS ms FROM llm_calls GROUP BY step, model, source ORDER BY usd DESC`).all() as { step: string; model: string; source: string; n: number; usd: number; ms: number }[];
  const total = spend.reduce((s, r) => s + (r.usd ?? 0), 0);
  const steps = ["intent", "extract", "analyze", "draft", "assistant", "asr"] as const;

  return (
    <Page narrow>
      <PageHeader title="Settings" description="Your scope, the AI models in use and what they cost, and your data." />
      <Section title="Your scope">
        <Card className="p-5">
          <ProfileForm profile={profile.key} ownNames={JSON.parse(ws.own_names) as string[]} profiles={Object.entries(PROFILES).map(([k, v]) => ({ key: k, label: v.label, description: v.description }))} />
        </Card>
      </Section>
      <Section title="WeChat">
        <Link href="/wechat" className="lift flex items-center gap-4 rounded-2xl border border-line bg-card px-5 py-4">
          <span className="grid place-items-center size-10 rounded-full bg-wechat-soft text-wechat-dark shrink-0"><Icon name="wechat" className="size-5" /></span>
          <span className="flex-1 min-w-0">
            <span className="flex items-center gap-2 text-[15px] font-medium">WeChat bot {wecomConfigured() ? <Pill tone="ok">Keys set</Pill> : <Pill tone="warn">Not configured</Pill>}</span>
            <span className="block text-[13.5px] text-muted">QR code to connect, what you can send, shortcuts and recent activity.</span>
          </span>
          <Icon name="arrow" className="size-4 text-muted" />
        </Link>
      </Section>
      <Section title="AI models">
        <Card className="p-5 text-[14px]">
          <div className="flex items-center gap-2 mb-3">Provider <Pill tone={provider === "mock" ? "warn" : "ok"}>{provider}</Pill>{provider === "mock" && <span className="text-[12.5px] text-muted">rules + saved answers; set LLM_PROVIDER=gateway or anthropic to use AI</span>}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 text-[13px]">
            {steps.map((s) => <div key={s} className="flex justify-between gap-2"><span className="text-muted">{s}</span><span className="font-mono text-[12.5px]">{modelFor(s)}</span></div>)}
          </div>
        </Card>
      </Section>
      <Section title="AI spend" right={<span className="tabular">≈ ${total.toFixed(3)}</span>}>
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-[12.5px] text-muted border-b border-line"><th className="px-5 py-2.5 font-normal">Step</th><th className="px-5 py-2.5 font-normal">Model</th><th className="px-5 py-2.5 font-normal">Source</th><th className="px-5 py-2.5 font-normal text-right">Calls</th><th className="px-5 py-2.5 font-normal text-right">Avg</th><th className="px-5 py-2.5 font-normal text-right">$</th></tr></thead>
            <tbody className="divide-y divide-line tabular">
              {spend.map((r, i) => <tr key={i}><td className="px-5 py-2.5">{r.step}</td><td className="px-5 py-2.5 font-mono text-[12.5px]">{r.model}</td><td className="px-5 py-2.5">{r.source}</td><td className="px-5 py-2.5 text-right">{r.n}</td><td className="px-5 py-2.5 text-right">{(r.ms / 1000).toFixed(1)} s</td><td className="px-5 py-2.5 text-right">{(r.usd ?? 0).toFixed(4)}</td></tr>)}
              {!spend.length && <tr><td colSpan={6} className="px-5 py-5 text-muted">No calls yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Section>
      <Section title="Data">
        <Card className="p-5"><DemoReset /></Card>
      </Section>
    </Page>
  );
}
