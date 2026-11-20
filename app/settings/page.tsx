import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { provider, modelFor } from "@/lib/adapters/llm";
import { wecomConfigured } from "@/lib/channels/wecom";
import { PROFILES } from "@/lib/core/domain";
import { Card, PageHeader, Section, Pill } from "@/components/ui";
import { ProfileForm, WeChatConnect, DemoReset } from "@/components/SettingsActions";

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
    <div className="rise max-w-3xl">
      <PageHeader title="Settings" />
      <Section title="Your scope">
        <Card className="p-4">
          <ProfileForm profile={profile.key} ownNames={JSON.parse(ws.own_names) as string[]} profiles={Object.entries(PROFILES).map(([k, v]) => ({ key: k, label: v.label, description: v.description }))} />
        </Card>
      </Section>
      <Section title="WeChat">
        <Card className="p-4 text-sm space-y-3">
          <div className="flex items-center gap-2">{wecomConfigured() ? <Pill tone="ok">Configured</Pill> : <Pill tone="warn">Not configured</Pill>}<span className="text-muted">Callback URL: <code className="text-ink">/api/wecom/callback</code></span></div>
          {!wecomConfigured() && <p className="text-muted">Set the <code>WECOM_*</code> variables in <code>.env.local</code> (see the README, “WeChat setup”). Until then, use the simulator.</p>}
          <WeChatConnect enabled={wecomConfigured()} />
        </Card>
      </Section>
      <Section title="AI models">
        <Card className="p-4 text-sm">
          <div className="flex items-center gap-2 mb-3">Provider <Pill tone={provider === "mock" ? "warn" : "ok"}>{provider}</Pill>{provider === "mock" && <span className="text-xs text-muted">rules + saved answers; set LLM_PROVIDER=gateway or anthropic to use AI</span>}</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5 text-[13px]">
            {steps.map((s) => <div key={s} className="flex justify-between gap-2"><span className="text-muted">{s}</span><span className="font-mono text-xs">{modelFor(s)}</span></div>)}
          </div>
        </Card>
      </Section>
      <Section title="AI spend" right={<span className="tabular">≈ ${total.toFixed(3)}</span>}>
        <Card className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-xs text-muted border-b border-line"><th className="px-4 py-2 font-normal">Step</th><th className="px-4 py-2 font-normal">Model</th><th className="px-4 py-2 font-normal">Source</th><th className="px-4 py-2 font-normal text-right">Calls</th><th className="px-4 py-2 font-normal text-right">Avg</th><th className="px-4 py-2 font-normal text-right">$</th></tr></thead>
            <tbody className="divide-y divide-line tabular">
              {spend.map((r, i) => <tr key={i}><td className="px-4 py-2">{r.step}</td><td className="px-4 py-2 font-mono text-xs">{r.model}</td><td className="px-4 py-2">{r.source}</td><td className="px-4 py-2 text-right">{r.n}</td><td className="px-4 py-2 text-right">{(r.ms / 1000).toFixed(1)} s</td><td className="px-4 py-2 text-right">{(r.usd ?? 0).toFixed(4)}</td></tr>)}
              {!spend.length && <tr><td colSpan={6} className="px-4 py-4 text-muted">No calls yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </Section>
      <Section title="Data">
        <Card className="p-4"><DemoReset /></Card>
      </Section>
    </div>
  );
}
