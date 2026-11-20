#!/usr/bin/env bash
# Memini — server setup + (re)start. Runs ON the VPS (Ubuntu 22.04/24.04 or Debian 12), from the app folder.
# Idempotent: the first run installs everything; later runs only rebuild and restart.
# Usually called by scripts/deploy.sh from your laptop; can also be run by hand:  bash scripts/server-setup.sh
#
# Optional environment:
#   PUBLIC_HOST=1.2.3.4      public IP or domain (used for APP_BASE_URL in a new .env.local)
#   DOMAIN=memini.example.com  serve this domain with automatic HTTPS instead of plain :80 on the IP
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"
# run a command as root whether we logged in as root (Alibaba) or as a sudo user (Tencent Lighthouse: ubuntu)
SUDO() { if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi; }
say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) echo "This script supports Ubuntu/Debian (found: ${ID:-unknown})."; exit 1 ;; esac
export DEBIAN_FRONTEND=noninteractive

# ── 1. system packages ──
say "System packages (git, ffmpeg, build tools)"
SUDO apt-get update -qq
SUDO apt-get install -y -qq git curl ca-certificates gnupg ffmpeg build-essential python3 ufw cron >/dev/null

# ── 2. Node 22 ──
if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  say "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | SUDO bash - >/dev/null
  SUDO apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v), npm $(npm -v)"

# ── 3. pm2 (keeps ONE app process alive and restarts it on reboot) ──
if ! command -v pm2 >/dev/null; then
  say "pm2"
  SUDO npm install -g pm2 >/dev/null
fi

# ── 4. Caddy (reverse proxy on port 80/443) ──
if ! command -v caddy >/dev/null; then
  say "Caddy"
  SUDO apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | SUDO gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | SUDO tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  SUDO apt-get update -qq && SUDO apt-get install -y -qq caddy >/dev/null
fi

# ── 5. swap: `next build` needs more than 2 GB of RAM ──
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3500 ] && ! SUDO swapon --show | grep -q .; then
  say "2 GB swap (RAM is ${MEM_MB} MB)"
  SUDO fallocate -l 2G /swapfile && SUDO chmod 600 /swapfile && SUDO mkswap /swapfile >/dev/null && SUDO swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | SUDO tee -a /etc/fstab >/dev/null
fi

# ── 6. firewall: SSH, HTTP, HTTPS only (the app's port 3000 stays private) ──
say "Firewall"
SUDO ufw allow 22/tcp >/dev/null; SUDO ufw allow 80/tcp >/dev/null; SUDO ufw allow 443/tcp >/dev/null
SUDO ufw --force enable >/dev/null
SUDO ufw status | sed -n '1,8p'

# ── 7. .env.local (created once; never overwritten) ──
if [ ! -f .env.local ]; then
  say "Creating .env.local (AI off until you add keys)"
  HOST="${DOMAIN:-${PUBLIC_HOST:-$(hostname -I | awk '{print $1}')}}"
  SCHEME="http"; [ -n "${DOMAIN:-}" ] && SCHEME="https"
  cat > .env.local <<EOF
# Memini — server settings. Edit with: nano .env.local   then re-run: bash scripts/server-setup.sh
LLM_PROVIDER=mock
# LLM_PROVIDER=gateway
# GATEWAY_BASE_URL=
# GATEWAY_API_KEY=          # the demo-prod key: only here, never on laptops
# GATEWAY_API_STYLE=anthropic

APP_BASE_URL=${SCHEME}://${HOST}
LINK_SECRET=$(openssl rand -hex 32)
APP_TIMEZONE=Asia/Shanghai
DB_PATH=./storage/memini.db
STORAGE_DIR=./storage/files

# WeChat (guide, Fase 3)
WECOM_CORP_ID=
WECOM_APP_SECRET=
WECOM_AGENT_ID=
WECOM_CALLBACK_TOKEN=
WECOM_ENCODING_AES_KEY=
WECOM_OPEN_KFID=
EOF
  chmod 600 .env.local
fi
mkdir -p storage/files

# ── 8. build ──
say "Installing dependencies and building (a few minutes the first time)"
npm ci --no-audit --no-fund
npm run build

# ── 9. start / reload the app ──
say "Starting the app with pm2"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null
if [ ! -f "/etc/systemd/system/pm2-$(whoami).service" ]; then
  SUDO env PATH="$PATH" "$(command -v pm2)" startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null
fi

# ── 10. Caddy config ──
say "Reverse proxy"
if [ -n "${DOMAIN:-}" ]; then SITE="$DOMAIN"; else SITE=":80"; fi
CADDYFILE="$(printf '%s {\n\tencode gzip\n\treverse_proxy 127.0.0.1:3000\n\tlog {\n\t\toutput file /var/log/caddy/memini.log\n\t}\n}\n' "$SITE")"
if [ "$(cat /etc/caddy/Caddyfile 2>/dev/null)" != "$CADDYFILE" ]; then
  printf '%s\n' "$CADDYFILE" | SUDO tee /etc/caddy/Caddyfile >/dev/null
  SUDO mkdir -p /var/log/caddy && SUDO chown caddy:caddy /var/log/caddy 2>/dev/null || true
  SUDO systemctl reload caddy || SUDO systemctl restart caddy
fi

# ── 11. daily backup of storage/ (03:00, keep 14) ──
BACKUP="0 3 * * * mkdir -p \$HOME/backups && tar czf \$HOME/backups/memini-\$(date +\\%F).tgz -C $APP_DIR storage && ls -1t \$HOME/backups/memini-*.tgz | tail -n +15 | xargs -r rm --"
( (crontab -l 2>/dev/null || true) | grep -v 'backups/memini-' || true; echo "$BACKUP" ) | crontab -

# ── 12. health check ──
say "Health check"
HEALTHY=""
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then HEALTHY=1; break; fi
  sleep 2
done
if [ -z "$HEALTHY" ]; then
  echo "❌ The app did not start. Last log lines:"; pm2 logs memini --lines 40 --nostream; exit 1
fi
curl -fsS http://127.0.0.1:3000/api/health; echo
if [ -z "${DOMAIN:-}" ] && ! curl -fsS --max-time 5 http://127.0.0.1/api/health >/dev/null; then
  echo "⚠️  The app runs but Caddy on port 80 does not answer: sudo systemctl status caddy"
fi
URL="$(grep '^APP_BASE_URL=' .env.local | cut -d= -f2-)"
echo
echo "✅ Memini is running: $URL"
echo "   WeChat callback URL: $URL/api/wecom/callback"
echo "   Logs: pm2 logs memini    Restart after editing .env.local: bash scripts/server-setup.sh"
