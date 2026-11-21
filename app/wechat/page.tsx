import { appDb, CURRENT_WS, workspaceProfile } from "@/lib/server";
import { wecomConfigured } from "@/lib/channels/wecom";
import { provider } from "@/lib/adapters/llm";
import { originalFileName } from "@/lib/core/extract";
import { WeChatQR } from "@/components/WeChatQR";
import { Card, Dot, Pill, ago } from "@/components/ui";
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
    <div className="max-w-[1080px] mx-auto px-4 sm:px-8 py-10 sm:py-14">
      <header className="enter mb-10">
        <div className="text-[13px] font-medium text-muted mb-2 flex items-center gap-2"><Dot tone={status.tone} live={linked} />{status.label}</div>
        <h1 className="display text-[44px] sm:text-[52px] leading-[1.02]">Memini on WeChat</h1>
        <p className="text-[16px] leading-relaxed text-muted mt-3 max-w-[58ch]">
          Forward anything to the Memini chat in WeChat: I translate it, file it under the right {business ? "contact and matter" : "supplier and purchase"}, check it against what you already have, and keep track of every date. {status.line}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)] items-start">
        <Card className="enter-2 p-8">
          <WeChatQR enabled={configured} linked={linked} />
        </Card>

        <div className="enter-3 space-y-6">
          <div className="grid grid-cols-3 gap-3 min-w-0">
            {[["Today", todayN], ["All time", total], ["Documents", docs]].map(([l, v]) => (
              <Card key={l} className="px-5 py-4">
                <div className="text-[13px] text-muted">{l}</div>
                <div className="display text-[34px] leading-none tabular mt-2">{v}</div>
              </Card>
            ))}
          </div>

          <Card>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="text-[14px] font-semibold">How to start</h2>
            </div>
            <ol className="px-5 pb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
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

          <Card className="flex flex-col">
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="text-[14px] font-semibold">Recently from WeChat</h2>
              {linked && <span className="inline-flex items-center gap-1.5 text-[12.5px] text-wechat-dark"><Dot tone="wechat" live />Live</span>}
            </div>
            <div className="divide-y divide-line">
              {recent.map((m) => {
                const k = KIND[m.kind] ?? KIND.text;
                const text = m.text_original ?? (m.file_path && m.kind === "file" ? originalFileName(m.file_path) : ""); // photos and voice notes arrive with a media id as name
                return (
                  <div key={m.id} className={`flex items-center gap-3 px-5 py-3 ${Date.now() - +new Date(m.received_at) < 120000 ? "flash" : ""}`}>
                    <span className="grid place-items-center size-8 rounded-full bg-wechat-soft text-wechat-dark shrink-0"><Icon name={k.icon} className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] truncate">{text || k.label}</span>
                      <span className="block text-[12.5px] text-muted">{k.label}{m.original_author ? ` · ${m.original_author}` : ""}{m.intent === "question" ? " · question" : ""}</span>
                    </span>
                    <span className="text-[12px] text-faint whitespace-nowrap tabular">{ago(m.received_at)}</span>
                  </div>
                );
              })}
              {!recent.length && <div className="px-5 py-8 text-center text-[13.5px] text-muted">Nothing yet. Forward your first message and it appears here.</div>}
            </div>
          </Card>
        </div>
      </div>

      <section className="mt-16">
        <h2 className="display text-[32px] leading-tight mb-6">What you can send</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sendables.map((s) => (
            <Card key={s.title} className="p-5">
              <span className="grid place-items-center size-9 rounded-xl bg-line-2 text-ink-2"><Icon name={s.icon} className="size-[18px]" /></span>
              <h3 className="text-[15px] font-semibold mt-4">{s.title}</h3>
              <p className="text-[14px] text-muted leading-relaxed mt-1">{s.text}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mt-16 grid grid-cols-1 gap-6 lg:grid-cols-2 items-start">
        <div>
          <h2 className="display text-[32px] leading-tight mb-6">Shortcuts</h2>
          <Card className="divide-y divide-line">
            {commands.map(([c, d]) => (
              <div key={c} className="flex items-baseline gap-4 px-5 py-3">
                <code className="font-mono text-[13.5px] bg-line-2 rounded-md px-2 py-0.5 shrink-0 min-w-24 text-center">{c}</code>
                <span className="text-[14px] text-ink-2">{d}</span>
              </div>
            ))}
          </Card>
          <p className="text-[13px] text-muted mt-3">They work in the chat on the Home page too.</p>
        </div>
        <div>
          <h2 className="display text-[32px] leading-tight mb-6">Good to know</h2>
          <Card className="divide-y divide-line">
            {[
              ["Things sent together are read together", "I wait a few seconds after your last message, so a chat, a PDF and a photo about the same deal become one item."],
              ["I never guess who it's from", "Without a company name or credit code I ask with buttons, or it waits in To file on the web."],
              ["Replies are limited by WeChat", "WeChat lets the bot send a few messages per conversation. If there's more, I keep it and send it after your next message."],
              ["Links open a private page", "“Details” links show the full record on your phone and expire after 14 days."],
            ].map(([t, d]) => (
              <div key={t} className="px-5 py-3.5">
                <div className="text-[14.5px] font-medium">{t}</div>
                <div className="text-[13.5px] text-muted leading-relaxed mt-0.5">{d}</div>
              </div>
            ))}
          </Card>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="text-[15px] font-semibold mb-3">Connection</h2>
        <Card className="px-5 py-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-[13.5px]">
          <div><div className="text-muted">WeCom keys</div><div className="mt-1">{configured ? <Pill tone="ok">Set</Pill> : <Pill tone="warn">Missing</Pill>}</div></div>
          <div><div className="text-muted">Linked WeChat accounts</div><div className="mt-1 tabular font-medium">{linkedUsers}</div></div>
          <div><div className="text-muted">AI</div><div className="mt-1">{provider === "mock" ? <Pill tone="warn">Not connected</Pill> : <Pill tone="ok">{provider}</Pill>}</div></div>
          <div><div className="text-muted">Callback</div><div className="mt-1 font-mono text-[12.5px] break-all">/api/wecom/callback</div></div>
        </Card>
      </section>
    </div>
  );
}
