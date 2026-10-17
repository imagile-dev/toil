// Prints every divergence in docs/divergences/*.json as one markdown table,
// for reading or pasting into a PR. The JSON files are the record; this is a
// view of them, so there's no generated table in the repo for twenty integrations
// to fight over. A summary of the exceptions, produced on request, as is customary.
//
//   node scripts/divergences.mjs [area...]
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'divergences');
const only = new Set(process.argv.slice(2));
const cell = (text) => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const principle = (p) => (/^\d+$/.test(p) ? `Principle ${p}` : p === 'decision' ? 'Product decision' : p);

const rows = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const { scope, divergences } = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  if (only.size > 0 && !only.has(scope)) continue;
  for (const d of divergences) {
    const allows = d.allows.length > 0 ? d.allows.map((id) => `\`${id}\``).join(', ') : 'behavior only';
    const why = `${d.class === 'security' ? '**Security.** ' : ''}${principle(d.principle)}: ${d.why}`;
    rows.push(`| ${scope} | ${cell(d.old)} | ${cell(d.toil)} | ${cell(why)} | ${allows} |`);
  }
}
process.stdout.write(['| Scope | Old | toil | Why | Allows |', '|-------|-----|------|-----|--------|', ...rows, ''].join('\n'));
