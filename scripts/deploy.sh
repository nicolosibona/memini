#!/usr/bin/env bash
# Memini — deploy from your laptop to the VPS. No GitHub needed: copies the working folder over SSH.
#
#   scripts/deploy.sh ubuntu@1.2.3.4                     first install or update, served on http://1.2.3.4
#   DOMAIN=memini.example.com scripts/deploy.sh ubuntu@1.2.3.4   same, with HTTPS on your domain
#
# Never copied: node_modules, build output, storage/ (the server keeps its own data), .env.local (the server has its own).
set -euo pipefail

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: scripts/deploy.sh <user>@<server-ip>   (e.g. ubuntu@43.100.1.2)"; exit 1
fi
HOST="${TARGET#*@}"
cd "$(dirname "$0")/.."

echo "▸ Checking SSH access to $TARGET"
ssh -o ConnectTimeout=10 -o BatchMode=yes "$TARGET" true 2>/dev/null || {
  echo "Cannot log in to $TARGET with your SSH key."
  echo "Check the IP and user (Tencent Lighthouse: ubuntu, Alibaba: root) and that your public key (~/.ssh/id_ed25519.pub) was added to the server."
  exit 1
}

echo "▸ Copying the app to $TARGET:~/memini"
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .next-build --exclude storage \
  --exclude .env.local --exclude '.env*.local' --exclude .git --exclude .claude --exclude coverage --exclude '*.tsbuildinfo' \
  ./ "$TARGET:memini/"

echo "▸ Installing / restarting on the server"
ssh -t "$TARGET" "PUBLIC_HOST='$HOST' DOMAIN='${DOMAIN:-}' bash ~/memini/scripts/server-setup.sh"

echo "▸ Checking from outside"
if curl -fsS --max-time 10 "http://$HOST/api/health" >/dev/null; then
  echo "✅ Reachable from the internet: http://$HOST"
else
  echo "⚠️  The app runs, but http://$HOST is not reachable from here."
  echo "   Open ports 80 and 443 in your cloud provider's firewall (Tencent Lighthouse: Firewall tab; Alibaba: Security group)."
fi
