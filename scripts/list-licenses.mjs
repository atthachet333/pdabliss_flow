#!/usr/bin/env node
// G02: list licences of every installed package (direct and transitive) and flag
// anything that is not a common permissive/open licence for manual review.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const nm = join(root, 'node_modules');
const OK =
  /^(MIT|ISC|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|0BSD|OFL-1\.1|CC0-1\.0|BlueOak-1\.0\.0|Python-2\.0|CC-BY-4\.0|Unlicense|MPL-2\.0)$/;

const seen = new Map();
const visit = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (name.startsWith('@')) {
      visit(p);
      continue;
    }
    const pkgPath = join(p, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        if (pkg.name && !pkg.name.startsWith('@flow/')) {
          const lic =
            typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN');
          seen.set(`${pkg.name}@${pkg.version}`, lic);
        }
      } catch {
        /* ignore malformed */
      }
      visit(join(p, 'node_modules'));
    }
  }
};
visit(nm);

const counts = {};
const review = [];
for (const [id, lic] of seen) {
  counts[lic] = (counts[lic] ?? 0) + 1;
  const parts = lic.replace(/[()]/g, '').split(/\s+(?:OR|AND)\s+/);
  if (!parts.every((x) => OK.test(x))) review.push(`${id}: ${lic}`);
}
console.log(`Packages: ${seen.size}`);
console.log('By licence:', JSON.stringify(counts, null, 1));
console.log(
  review.length
    ? `Needs review (${review.length}):\n${review.join('\n')}`
    : 'All licences are in the permissive allow-list.',
);
