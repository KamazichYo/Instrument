#!/usr/bin/env bash
# Проверка окружения Motion Studio и установка Playwright + Chromium рядом с движком (один раз).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
ok() { printf '  ✔ %s\n' "$1"; }
bad() { printf '  ✖ %s\n' "$1"; MISSING=1; }
echo "Motion Studio — проверка окружения"
command -v node >/dev/null && ok "node $(node -v)" || bad "Node.js 18+ — https://nodejs.org"
command -v ffmpeg >/dev/null && ok "ffmpeg $(ffmpeg -version | head -1 | cut -d' ' -f3)" || bad "ffmpeg — macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg · Windows: winget install ffmpeg"
command -v ffprobe >/dev/null && ok "ffprobe" || bad "ffprobe (идёт вместе с ffmpeg)"
[ -n "$MISSING" ] && { echo "Установи недостающее и запусти снова."; exit 1; }

if node -e "import('$HERE/cli.mjs').then(m=>{m.loadPlaywright();process.exit(0)})" >/dev/null 2>&1; then
  ok "Playwright найден"
else
  echo "  … ставлю Playwright в $HERE/node_modules"
  [ -f "$HERE/package.json" ] || echo '{"private":true,"type":"module"}' > "$HERE/package.json"
  (cd "$HERE" && npm install --silent --no-audit --no-fund playwright@1)
  (cd "$HERE" && npx playwright install chromium)
  ok "Playwright + Chromium"
fi
# проверка запуска браузера
node -e "import('$HERE/cli.mjs').then(async m=>{const {chromium}=m.loadPlaywright();const b=await chromium.launch();await b.close();console.log('  ✔ Chromium запускается')}).catch(e=>{console.error('  ✖ Chromium не стартует: '+e.message);process.exit(1)})"
echo "Готово. Шаблоны: node $HERE/new.mjs --list"
