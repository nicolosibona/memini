// Cloudflare Email Worker for Email-to-Memini (free; needs a domain on Cloudflare DNS).
// Setup: Cloudflare dashboard → your domain → Email → Email Routing → enable → Routing rules → Catch-all
// → action "Send to a Worker" → this Worker. Set two Worker variables:
//   MEMINI_URL  = https://your-memini-host   (or http://<VPS-IP>)
//   EMAIL_TOKEN = the token part of the address shown in Memini → Settings → Email (the part before @)
// With a catch-all, forward to <token>@your-domain; the Worker posts the raw email to Memini.
const worker = {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const token = (message.to.split("@")[0] || "").split("+").pop() || env.EMAIL_TOKEN;
    const res = await fetch(`${env.MEMINI_URL.replace(/\/$/, "")}/api/inbound/email/${token}`, {
      method: "POST",
      headers: { "content-type": "message/rfc822" },
      body: raw,
    });
    if (!res.ok) message.setReject(`Memini refused the email (${res.status})`);
  },
};

export default worker;
