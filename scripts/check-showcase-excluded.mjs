#!/usr/bin/env node
// G08: prove the dev-only design showcase is absent from the production web bundle.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../apps/web/dist', import.meta.url));
const MARKERS = ['FLOW_DESIGN_SHOWCASE_DEV_ONLY', '/dev/design-showcase', 'Design Showcase'];

if (!existsSync(dist)) {
  console.error('apps/web/dist not found — run the web production build first.');
  process.exit(1);
}

const hits = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|css|html|map)$/.test(name)) {
      const text = readFileSync(p, 'utf8');
      for (const m of MARKERS) if (text.includes(m)) hits.push(`${p}: contains "${m}"`);
    }
  }
};
walk(dist);

if (hits.length > 0) {
  console.error('FAIL: showcase code found in production bundle:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('PASS: production bundle contains no design-showcase code or route.');
