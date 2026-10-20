// Compares what `toil util owi map` made of the board with items.owi.json, the
// file the board was seeded from, and prints every difference:
//
//   toil ado-cloud work-item iterations --project "<project>"            >  board.jsonl
//   toil ado-cloud work-item get-many <ids…>                             >> board.jsonl
//   toil ado-cloud work-item history <id>   (once per id)                >> board.jsonl
//   toil util owi map board.jsonl > mapped.json
//   node ui/scripts/ado-seed/compare.mjs mapped.json --project "<project>"
//
// Each mapped item is matched to its record by its `seed:<key>` tag, so no id
// map is needed. What the server assigns is left out: ids, urls, who created
// it, when it last changed, the reason it finished. When the seed was
// backdated (--backdated), its creation time and its history are compared
// with the record's timeline; otherwise only the order of its states is.
// Exits 1 when anything differs. Repo tooling only: nothing here ships. An
// audit of the audit trail, which is how these things usually end.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_OUT, SEED_CONNECTION } from './generate.mjs';

const keyOfLabels = (labels) => labels.find((l) => l.startsWith('seed:'))?.slice(5);
// Azure DevOps normalises the HTML it stores: runs of space collapse, and a space appears before a closing tag.
const text = (html) => String(html ?? '').replace(/\s+/g, ' ').replace(/\s+(<\/)/g, '$1').trim();

/** Every difference between the seed's records and the mapped items, as `<key> <field>: <seed> ≠ <board>` lines. */
export function compare(records, mapped, { project, backdated = false }) {
  const out = [];
  const byKey = new Map();
  for (const item of mapped) {
    const key = keyOfLabels(item.labels);
    if (key) byKey.set(key, item);
  }
  // Seed ids, as the board's OWI ids.
  const toBoard = new Map([...byKey].map(([key, item]) => [`${SEED_CONNECTION}:${key}`, item.id]));
  const ref = (id) => (id === null ? null : (toBoard.get(id) ?? `${id} (not on the board)`));
  const path = (p) => (p === null ? null : p.replace('@project', project));
  const same = (key, field, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${key} ${field}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  };
  for (const record of records) {
    const key = record.source.key;
    const item = byKey.get(key);
    if (!item) {
      out.push(`${key}: not on the board`);
      continue;
    }
    const seed = record.native['ado-seed generate'];
    for (const field of ['type', 'typeName', 'title', 'status', 'statusCategory', 'priority', 'estimate', 'team', 'dueDate']) same(key, field, record[field], item[field]);
    same(key, 'body', text(record.body?.content), text(item.body?.content));
    same(key, 'assignee', record.assignee === null ? 'nobody' : 'the token', item.assignee === null ? 'nobody' : 'the token');
    same(key, 'labels', [...record.labels].sort(), [...item.labels].sort());
    same(key, 'iteration', { name: path(record.iteration.name), path: path(record.iteration.path) }, item.iteration && { name: item.iteration.name, path: item.iteration.path });
    same(key, 'parent', ref(record.parent), item.parent);
    same(key, 'children', record.children.map(ref).sort(), [...item.children].sort());
    const link = (l) => `${l.type} ${l.direction} ${l.target} ${l.name}`;
    same(key, 'links', record.links.map((l) => link({ ...l, target: ref(l.target) })).sort(), item.links.map(link).sort());
    const states = seed.timeline.filter((e) => e.state);
    const moves = seed.timeline.filter((e) => e.iteration);
    const transitions = item.history?.transitions ?? [];
    same(key, 'history.states', states.map((e) => e.state), transitions.map((t) => t.to));
    same(key, 'history.iterations', moves.map((e) => path(e.iteration)), (item.history?.iterations ?? []).map((m) => m.to[0]));
    if (backdated) {
      same(key, 'created', seed.timeline[0].at, item.created);
      same(key, 'history.at', states.map((e) => e.at), transitions.map((t) => t.at));
      same(key, 'history.iterations.at', moves.map((e) => e.at), (item.history?.iterations ?? []).map((m) => m.at));
      same(key, 'resolved', record.statusCategory === 'DONE' && record.status === 'Done' ? states.at(-1).at : null, record.status === 'Removed' ? null : item.resolved);
    }
  }
  const seeded = new Set(records.map((r) => r.source.key));
  for (const key of byKey.keys()) if (!seeded.has(key)) out.push(`${key}: on the board, not in the file`);
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const take = (name) => {
    const at = args.indexOf(name);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const project = take('--project');
  const file = resolve(take('--file') ?? DEFAULT_OUT);
  const backdated = args.includes('--backdated') && Boolean(args.splice(args.indexOf('--backdated'), 1));
  const [mappedFile, ...rest] = args;
  if (!project || !mappedFile || rest.length) {
    process.stderr.write('compare: name the mapped file and the project.\n  Fix: node ui/scripts/ado-seed/compare.mjs mapped.json --project "<project>" [--backdated] [--file items.owi.json]\n');
    process.exit(1);
  }
  const mapped = JSON.parse(readFileSync(mappedFile, 'utf8').replace(/^\uFEFF/, ''));
  const items = mapped.data?.items ?? mapped.items;
  const records = JSON.parse(readFileSync(file, 'utf8')).items;
  const diffs = compare(records, items, { project, backdated });
  process.stdout.write(diffs.length ? `${diffs.length} difference(s):\n  ${diffs.join('\n  ')}\n` : `All ${records.length} records match the board${backdated ? ', dates and history included' : ''}.\n`);
  process.exit(diffs.length ? 1 : 0);
}
