#!/usr/bin/env bash
# PDFs and PNGs of the electronics spec-check demo documents (data/demo/spec/*.html) → public/demo/spec/,
# so they can be opened on a phone and forwarded to the WeChat bot. Needs Google Chrome (macOS path below or $CHROME).
set -euo pipefail
cd "$(dirname "$0")/.."
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
OUT=public/demo/spec
mkdir -p "$OUT"
for f in data/demo/spec/*.html; do
  name=$(basename "$f" .html)
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT/$name.pdf" "file://$PWD/$f" 2>/dev/null
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=900,1180 --screenshot="$OUT/$name.png" "file://$PWD/$f" 2>/dev/null
  echo "✓ $name (.pdf, .png)"
done
