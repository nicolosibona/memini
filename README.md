# ChopCheck

Bilingual deal copilot for buyers sourcing in China: a web app + a WeChat (微信客服) bot sharing one structured memory of suppliers, documents and facts.

**Start here:** [`chopcheck_blueprint.md`](chopcheck_blueprint.md) — product, architecture, data schema, WeChat setup, build plan, open decisions.

## Run it

```bash
export PATH=~/.local/node/bin:$PATH   # Node 22 lives here on Nicolò's Mac
npm install
cp .env.example .env.local            # LLM_PROVIDER=mock works with no key
npm run dev                           # http://localhost:3000
```
