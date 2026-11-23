import { appDb, CURRENT_USER, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { userToken } from "@/lib/core/tokens";
import { calendarFeedUrl, calendarPageUrl, webcalUrl } from "@/lib/core/calendar";
import { CalendarCard } from "@/components/CalendarCard";
import { EmailCard } from "@/components/EmailCard";
import { inboundAddress } from "@/lib/channels/email";
import { provider, modelFor } from "@/lib/adapters/llm";
import { wecomConfigured } from "@/lib/channels/wecom";
import { PROFILES } from "@/lib/core/domain";
import { Card, CardHead, Page, PageHeader, Pill, BracketLink } from "@/components/ui";
import { ProfileForm, DemoReset } from "@/components/SettingsActions";
import { LanguagePicker } from "@/components/LanguagePicker";
import { langOptions, workspaceLang } from "@/lib/core/lang";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const db = await appDb();
  const ws = db.prepare(`SELECT own_names FROM workspaces WHERE id = ?`).get(CURRENT_WS) as { own_names: string };
  const profile = workspaceProfile(db);
  const spend = db.prepare(`SELECT step, model, source, COUNT(*) AS n, SUM(est_cost_usd) AS usd, AVG(ms) AS ms FROM llm_calls GROUP BY step, model, source ORDER BY usd DESC`).all() as { step: string; model: string; source: string; n: number; usd: number; ms: number }[];
  const total = spend.reduce((s, r) => s + (r.usd ?? 0), 0);
  const cal = userToken(db, CURRENT_USER, "calendar");
  const steps = ["intent", "translate", "extract", "analyze", "draft", "assistant", "asr"] as const;

  return (
    <Page narrow>
      <PageHeader title="Settings." rest="Scope, channels and cost." description="Your scope, your channels, the models in use and what they cost, and your data." />
      <div className="space-y-6">
        <Card>
          <CardHead title="Your scope" />
          <div className="px-6 pb-6">
            <ProfileForm profile={profile.key} ownNames={JSON.parse(ws.own_names) as string[]} profiles={Object.entries(PROFILES).map(([k, v]) => ({ key: k, label: v.label, description: v.description }))} />
          </div>
        </Card>

        <Card>
          <CardHead title="Your language" />
          <div className="px-6 pb-6 space-y-3">
            <p className="text-[13.5px] text-muted leading-relaxed">What the supplier&apos;s Chinese is translated into, and what you write is translated from. In English, Italiano, Deutsch, Français and Español the bot&apos;s messages, the parameter names and the verification sheet are in your language too; in the others the AI translates and the rest stays in English. The WeChat bot follows this setting.</p>
            <LanguagePicker variant="field" value={workspaceLang(db, CURRENT_WS)} options={langOptions()} />
          </div>
        </Card>

        <Card>
          <CardHead title="WeChat" action={<BracketLink href="/wechat">Open bot page</BracketLink>} />
          <div className="px-6 pb-6 flex flex-wrap items-center gap-3 text-[14px] text-muted">
            {wecomConfigured() ? <Pill tone="ok">Keys set</Pill> : <Pill tone="warn">Not configured</Pill>}
            QR code to connect, what you can send, shortcuts and recent activity.
          </div>
        </Card>

        <CalendarCard initial={{ feed: calendarFeedUrl(cal), webcal: webcalUrl(cal), page: calendarPageUrl(cal) }} />
        <EmailCard initial={inboundAddress(db, CURRENT_USER)} />

        <Card>
          <CardHead title="AI models" />
          <div className="px-6 pb-6 text-[14px]">
            <div className="flex flex-wrap items-center gap-2 mb-4">Provider <Pill tone={provider === "mock" ? "warn" : "ok"}>{provider}</Pill>{provider === "mock" && <span className="text-[12.5px] text-muted">rules + saved answers; set LLM_PROVIDER=gateway or anthropic to use AI</span>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
              {steps.map((s) => <div key={s} className="flex justify-between gap-3 border-b border-line-2 pb-2"><span className="text-muted">{s}</span><span className="mono text-[12.5px] truncate">{modelFor(s)}</span></div>)}
            </div>
          </div>
        </Card>

        <Card className="overflow-x-auto">
          <CardHead title="AI spend" action={<span className="mono text-[13px] text-muted">≈ ${total.toFixed(3)}</span>} />
          <table className="w-full text-[13px] min-w-[520px]">
            <thead><tr className="text-left text-[12.5px] text-faint border-y border-line"><th className="px-6 py-3 font-normal">Step</th><th className="px-4 py-3 font-normal">Model</th><th className="px-4 py-3 font-normal">Source</th><th className="px-4 py-3 font-normal text-right">Calls</th><th className="px-4 py-3 font-normal text-right">Avg</th><th className="px-6 py-3 font-normal text-right">$</th></tr></thead>
            <tbody className="divide-y divide-line mono">
              {spend.map((r, i) => <tr key={i}><td className="px-6 py-3 font-sans">{r.step}</td><td className="px-4 py-3 text-[12.5px]">{r.model}</td><td className="px-4 py-3 font-sans">{r.source}</td><td className="px-4 py-3 text-right">{r.n}</td><td className="px-4 py-3 text-right">{(r.ms / 1000).toFixed(1)} s</td><td className="px-6 py-3 text-right">{(r.usd ?? 0).toFixed(4)}</td></tr>)}
              {!spend.length && <tr><td colSpan={6} className="px-6 py-6 text-muted font-sans">No calls yet.</td></tr>}
            </tbody>
          </table>
        </Card>

        <Card>
          <CardHead title="Data" />
          <div className="px-6 pb-6"><DemoReset /></div>
        </Card>
      </div>
    </Page>
  );
}
