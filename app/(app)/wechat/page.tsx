import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { wecomConfigured } from "@/lib/channels/wecom";
import { provider } from "@/lib/adapters/llm";
import { originalFileName } from "@/lib/core/extract";
import { WeChatQR } from "@/components/WeChatQR";
import { AmbientField } from "@/components/ambient/AmbientField";
import { Mist, Silk } from "@/components/ambient/Stage";
import { Card, CardHead, Dot, Page, Pill, Headline, Lede, ago } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { localDate } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "WeChat bot" };

const KIND: Record<string, { label: string; icon: string }> = {
  text: { label: "Message", icon: "chat" }, merged: { label: "Chat history", icon: "forward" }, voice: { label: "Voice note", icon: "mic" },
  image: { label: "Photo", icon: "image" }, file: { label: "File", icon: "file" },
};

export default async function WeChatPage() {
  const db = await appDb();
  const business = workspaceProfile(db).key === "china_business";
  const configured = wecomConfigured();
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  const linkedUsers = n(`SELECT COUNT(*) AS n FROM users WHERE wecom_external_userid IS NOT NULL`);
  const linked = configured && linkedUsers > 0;
  const total = n(`SELECT COUNT(*) AS n FROM messages WHERE workspace_id = ? AND channel = 'wecom' AND direction = 'in' AND kind NOT IN ('menu_click', 'event')`, CURRENT_WS);
  const todayN = (db.prepare(`SELECT received_at FROM messages WHERE workspace_id = ? AND channel = 'wecom' AND direction = 'in' AND kind NOT IN ('menu_click', 'event') ORDER BY received_at DESC LIMIT 500`).all(CURRENT_WS) as { received_at: string }[])
    .filter((m) => localDate(m.received_at) === localDate()).length;
  const docs = n(`SELECT COUNT(*) AS n FROM documents d JOIN messages m ON m.id = d.message_id WHERE d.workspace_id = ? AND m.channel = 'wecom'`, CURRENT_WS);
  const recent = db.prepare(
    `SELECT id, kind, intent, text_original, file_path, original_author, received_at FROM messages
     WHERE workspace_id = ? AND channel = 'wecom' AND direction = 'in' AND kind NOT IN ('menu_click', 'event') ORDER BY received_at DESC LIMIT 8`,
  ).all(CURRENT_WS) as { id: string; kind: string; intent: string | null; text_original: string | null; file_path: string | null; original_author: string | null; received_at: string }[];

  const status = linked ? { tone: "wechat" as const, label: "Connected", line: "Messages you forward arrive here within seconds." }
    : configured ? { tone: "warn" as const, label: "Ready to connect", line: "Scan the code with your WeChat to link it to this workspace." }
    : { tone: "neutral" as const, label: "Not set up", line: "Add the WeCom keys to the server's .env.local to switch the bot on." };

  const sendables = [
    { icon: "forward", title: "Forward a chat", text: business ? "Long-press a message from a supplier, landlord or agent and forward it. Merged chat histories keep who said what." : "Long-press a supplier's message and forward it. Merged chat histories keep who said what." },
    { icon: "file", title: "PDFs and files", text: business ? "Business licenses, proformas, contracts, tax notices, permits, bank slips." : "Business licenses, proformas, quotations, certificates, packing lists." },
    { icon: "image", title: "Photos and screenshots", text: "A photo of a paper contract, a screenshot of a quote. The text is read in Chinese and English." },
    { icon: "mic", title: "Voice notes", text: "Say what was agreed on the phone. It's transcribed and kept as your own note." },
    { icon: "chat", title: "Questions", text: business ? "“What's due this month?” “Any problems with my lease before I pay?”" : "“Which seller is cheaper?” “What did Lisa promise me?”" },
    { icon: "check", title: "Taps on menus", text: "When I'm not sure who something is from, I ask with buttons. One tap files it." },
  ];
  const commands = [
    ["/today", "What's due in the next 7 days, and anything waiting to be filed"],
    ["/deadlines", "Everything due in the next 45 days"],
    ["/alerts", "Open red flags and things to check"],
    ["/contacts", business ? "Everyone you deal with, with open alerts" : "Your suppliers, with open alerts"],
    ["/seller1", "Current terms and open issues of a seller (1, 2, …)"],
    ["agreed", "Mark the terms I just read as agreed"],
  ];

  return (
    <Page>
      <header className="enter mb-9 max-w-[780px]">
        <div className="text-[12.5px] font-medium text-faint mb-3 flex items-center gap-2"><Dot tone={status.tone} live={linked} />{status.label}</div>
        <Headline lead="Memini on WeChat." rest="Forward it, and it's remembered." />
        <Lede>Forward anything to the chat: I translate it, file it under the right {business ? "contact and matter" : "supplier and purchase"}, check it, and track every date. {status.line}</Lede>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[400px_minmax(0,1fr)] items-start">
        <Card tone="night" className="enter-2 relative overflow-hidden p-8">
          <Mist tone="night" />
          <Silk tone="night" />
          <AmbientField palette="night" />
          <div className="relative text-white"><WeChatQR enabled={configured} linked={linked} /></div>
        </Card>

        <div className="enter-3 space-y-6 min-w-0">
          <div className="grid grid-cols-3 gap-3">
            {[["Today", todayN], ["All time", total], ["Documents", docs]].map(([l, v]) => (
              <Card key={l} className="px-5 py-4">
                <div className="text-[13px] text-muted">{l}</div>
                <div className="display text-[40px] leading-none tabular mt-3">{v}</div>
              </Card>
            ))}
          </div>

          <Card>
            <CardHead title="How to start" />
            <ol className="px-6 pb-6 grid grid-cols-1 gap-5 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {[
                ["Scan", "Open WeChat → + → Scan, and point it at the code. The Memini chat opens."],
                ["Forward", "Send a message, file, photo or voice note. Several in a row are read together."],
                ["Ask", "Ask about anything you've sent. Every answer says where it comes from."],
              ].map(([t, d], i) => (
                <li key={t} className="flex gap-3">
                  <span className="grid place-items-center size-7 rounded-full bg-ink text-white text-[13px] font-semibold tabular shrink-0">{i + 1}</span>
                  <span><span className="block text-[14.5px] font-medium">{t}</span><span className="block text-[13.5px] text-muted leading-relaxed mt-0.5">{d}</span></span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHead title="Recently from WeChat" action={linked ? <span className="inline-flex items-center gap-1.5 text-[12.5px] text-wechat-dark"><Dot tone="wechat" live />Live</span> : undefined} />
            <div className="divide-y divide-line">
              {recent.map((m) => {
                const k = KIND[m.kind] ?? KIND.text;
                const text = m.text_original ?? (m.file_path && m.kind === "file" ? originalFileName(m.file_path) : ""); // photos and voice notes arrive with a media id as name
                return (
                  <div key={m.id} className={`flex items-center gap-3 px-6 py-3.5 ${Date.now() - +new Date(m.received_at) < 120000 ? "flash" : ""}`}>
                    <span className="grid place-items-center size-8 rounded-full bg-wechat-soft text-wechat-dark shrink-0"><Icon name={k.icon} className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] truncate">{text || k.label}</span>
                      <span className="block text-[12.5px] text-muted">{k.label}{m.original_author ? ` · ${m.original_author}` : ""}{m.intent === "question" ? " · question" : ""}</span>
                    </span>
                    <span className="text-[12px] text-faint whitespace-nowrap tabular">{ago(m.received_at)}</span>
                  </div>
                );
              })}
              {!recent.length && <div className="px-6 py-10 text-center text-[13.5px] text-muted">Nothing yet. Forward your first message and it appears here.</div>}
            </div>
          </Card>
        </div>
      </div>

      <section className="mt-20">
        <h2 className="text-[28px] font-medium tracking-[-0.03em] mb-6"><span className="text-ink">What you can send.</span> <span className="text-stone">Anything a counterparty sends you.</span></h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sendables.map((s) => (
            <Card key={s.title} tone="ivory" className="p-6">
              <span className="grid place-items-center size-10 rounded-2xl bg-card border border-line text-ink-2"><Icon name={s.icon} className="size-[18px]" /></span>
              <h3 className="text-[15px] font-medium mt-5">{s.title}</h3>
              <p className="text-[14px] text-muted leading-relaxed mt-1.5">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-20 grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        <div>
          <h2 className="text-[28px] font-medium tracking-[-0.03em] mb-6 text-ink">Shortcuts</h2>
          <Card className="divide-y divide-line">
            {commands.map(([c, d]) => (
              <div key={c} className="flex items-baseline gap-4 px-6 py-3.5">
                <code className="mono text-[13px] bg-line-2 rounded-lg px-2.5 py-0.5 shrink-0 min-w-24 text-center">{c}</code>
                <span className="text-[14px] text-ink-2">{d}</span>
              </div>
            ))}
          </Card>
          <p className="text-[13px] text-muted mt-3 px-1">They work in the conversation on Today too.</p>
        </div>
        <div>
          <h2 className="text-[28px] font-medium tracking-[-0.03em] mb-6 text-ink">Good to know</h2>
          <Card className="divide-y divide-line">
            {[
              ["Things sent together are read together", "I wait a few seconds after your last message, so a chat, a PDF and a photo about the same deal become one item."],
              ["I never guess who it's from", "Without a company name or credit code I ask with buttons, or it waits in To file."],
              ["Replies are limited by WeChat", "WeChat lets the bot send a few messages per conversation. If there's more, I keep it and send it after your next message."],
              ["Links open a private page", "“Details” links show the full record on your phone and expire after 14 days."],
            ].map(([t, d]) => (
              <div key={t} className="px-6 py-4">
                <div className="text-[14.5px] font-medium">{t}</div>
                <div className="text-[13.5px] text-muted leading-relaxed mt-0.5">{d}</div>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section className="mt-20">
        <h2 className="text-[15px] font-medium mb-3 px-1">Connection</h2>
        <Card className="px-6 py-5 grid grid-cols-2 gap-5 sm:grid-cols-4 text-[13.5px]">
          <div><div className="text-muted">WeCom keys</div><div className="mt-1.5">{configured ? <Pill tone="ok">Set</Pill> : <Pill tone="warn">Missing</Pill>}</div></div>
          <div><div className="text-muted">Linked WeChat accounts</div><div className="mt-1.5 mono font-medium">{linkedUsers}</div></div>
          <div><div className="text-muted">AI</div><div className="mt-1.5">{provider === "mock" ? <Pill tone="warn">Not connected</Pill> : <Pill tone="ok">{provider}</Pill>}</div></div>
          <div><div className="text-muted">Callback</div><div className="mt-1.5 mono text-[12.5px] break-all">/api/wecom/callback</div></div>
        </Card>
      </section>
    </Page>
  );
}
