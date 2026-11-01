// Мини-парсер аргументов: позиционные + --key value / --flag / -o value
export function parse(argv, boolFlags = []) {
  const pos = [], o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o') { o.out = argv[++i]; continue; }
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (boolFlags.includes(k) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) o[k] = true;
      else o[k] = argv[++i];
      continue;
    }
    pos.push(a);
  }
  return { pos, o };
}

// Playwright ищем везде: рядом с движком (setup.sh), в проекте, глобально.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
export function loadPlaywright() {
  const bases = [import.meta.url, path.join(process.cwd(), 'x.js')];
  try { bases.push(path.join(execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(), 'x.js')); } catch {}
  for (const b of bases) { try { return createRequire(b)('playwright'); } catch {} }
  console.error('✖ Нет Playwright. Запусти: bash ' + path.join(path.dirname(new URL(import.meta.url).pathname), 'setup.sh'));
  process.exit(3);
}
