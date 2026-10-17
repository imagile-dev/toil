// Writes the skeleton of one area from docs/command-contract.json: its
// defineArea, one area.command() per contract command with the exact path,
// positional arguments and flags, an index.ts, a fixture and a skill file.
// Every command's run() throws until it's ported, so the stub registers and
// the contract test passes on the surface at once, while the parity suite
// fails on every example until the real behavior is in. The form arrives
// pre-filled; the contents remain the applicant's responsibility.
//
//   node scripts/stub-area.mjs <area>        # writes into this checkout
//   node scripts/stub-area.mjs <area> --dry  # lists what it would write
//
// It never overwrites a file. Port behavior from the predecessor's source
// (the area's brief in docs/briefs/ says where), not from these stubs.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `--max-results <n>` -> `maxResults`; `--no-color` -> `color`. */
export function fieldOf(flags) {
  const long = flags.split(/[ ,|]+/).find((p) => p.startsWith('--')) ?? flags;
  const name = long.replace(/^--(no-)?/, '');
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** `[options] <key> [rest...]` -> [{ name: 'key', required: true }, { name: 'rest', required: false, variadic: true }]. */
export function argsOf(usage) {
  return usage
    .split(/\s+/)
    .filter((t) => (t.startsWith('<') || t.startsWith('[')) && t !== '[options]' && t !== '[command]')
    .map((t) => {
      const inner = t.slice(1, -1);
      const variadic = inner.endsWith('...');
      return { name: variadic ? inner.slice(0, -3) : inner, required: t.startsWith('<'), variadic };
    });
}

// A guess from the verb, to be checked against the predecessor: does the old command change anything?
export const WRITE_VERBS =
  /^(create|update|delete|remove|add|set|merge|decline|approve|unapprove|needs|transition|assign|link|log-work|upload|run|cancel|stop|toggle|kill|restore|archive|reply|resolve|enable|disable|enqueue|close|reopen|convert|ready|request|abandon|wait|install|uninstall|launch|start|end|batch|properties-set|forget|purge|sync)(?:-|$)/;

const camel = (name) => name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** The exported name of a command's stub: `ado repo list` -> `repoListCommand`. */
const exportName = (command) => `${camel(command.split(' ').slice(1).join('-'))}Command`;

function commandSource(entry, area, contextFields = new Set()) {
  const path = entry.command.split(' ');
  const args = argsOf(entry.usage);
  const options = entry.options;
  // One input field per argument and flag. A name already taken (an argument
  // and a flag both called `key`) gets a number, since the parity suite needs 1:1.
  const taken = new Set(['connection', 'allowWrite', ...contextFields]);
  const claim = (name) => {
    let field = name;
    for (let n = 2; taken.has(field); n++) field = `${name}${n}`;
    taken.add(field);
    return field;
  };
  const argFields = args.map((a) => claim(camel(a.name)));
  // A leaf flag the group also has (`bitbucket create-pr --project`) maps onto
  // the area's context input, which core adds; the command declares no field for it.
  const isContext = (o) => contextFields.has(fieldOf(o.flags));
  const optionFields = options.map((o) => (isContext(o) ? fieldOf(o.flags) : claim(fieldOf(o.flags))));
  const fields = [];
  args.forEach((a, i) => {
    const type = a.variadic ? 'z.array(z.string())' : 'z.string()';
    fields.push(`    ${argFields[i]}: ${type}${a.required ? '' : '.optional()'}.describe(${quote(a.name)}),`);
  });
  options.forEach((o, i) => {
    if (isContext(o)) return;
    const takes = /[<[]/.test(o.flags);
    const type = !takes ? 'z.boolean()' : /\.\.\.[>\]]/.test(o.flags) ? 'z.array(z.string())' : 'z.string()';
    fields.push(`    ${optionFields[i]}: ${type}.optional().describe(${quote(o.description || o.flags)}),`);
  });
  const writes = WRITE_VERBS.test(path[path.length - 1]);
  const example = args.flatMap((a, i) => (a.required ? [`${argFields[i]}: ${a.variadic ? "['TODO']" : "'TODO'"}`] : []));
  if (writes) example.push('allowWrite: true');
  return [
    `export const ${exportName(entry.command)} = ${camel(area)}Area.command({`,
    `  path: [${path.map(quote).join(', ')}],`,
    `  description: ${quote(entry.description || entry.command)},`,
    `  input: z.object({`,
    ...fields,
    ...(writes ? ['    ...allowWriteField,'] : []),
    `  }),`,
    `  // TODO: ${writes ? 'guessed from the verb' : 'a read, guessed from the verb'}; check what the predecessor's command does.`,
    `  writes: ${writes},`,
    ...(args.length
      ? [
          `  args: [`,
          ...args.map((a, i) => `    { name: ${quote(a.name)}, field: ${quote(argFields[i])}, description: ${quote(a.name)}${a.required ? '' : ', required: false'}${a.variadic ? ', variadic: true' : ''} },`),
          `  ],`,
        ]
      : []),
    ...(options.length ? [`  options: [`, ...options.map((o, i) => `    { flags: ${quote(o.flags)}, field: ${quote(optionFields[i])}, description: ${quote(o.description)} },`), `  ],`] : []),
    `  // TODO: one example per behavior worth pinning; together they must set every input field.`,
    `  examples: [{ ${example.join(', ')} }],`,
    `  run: async () => notPorted(${quote(entry.command)}),`,
    `});`,
  ].join('\n');
}

/** Command paths the divergence files allow outright: a whole command, not one of its flags or fields. */
export function removedPaths(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).divergences.flatMap((d) => d.allows))
    .filter((id) => !id.startsWith('--') && !/ --| data\./.test(id));
}

/**
 * Every file the stub for `area` needs, keyed by path from the repo root.
 * `core` is how area files import src/core (a test points it elsewhere).
 * `removed` holds command paths a divergence drops (`git credentials`); their
 * commands, and everything under them, are left out.
 */
export function stubFiles(contract, area, { core = '../../core', removed = [] } = {}) {
  const gone = (command) => removed.some((path) => command === path || command.startsWith(`${path} `));
  const entries = contract.commands.filter((c) => c.leaf && c.command.split(' ')[0] === area && !gone(c.command));
  if (entries.length === 0) throw new Error(`docs/command-contract.json has no commands under "${area}".`);
  // Nested commands (`ado repo list`) go in one file per group; a flat area gets commands.ts.
  // A group can't take the name of the area's own files.
  const groupOf = (c) => {
    const path = c.command.split(' ');
    if (path.length <= 2) return 'commands';
    return ['area', 'index', 'commands'].includes(path[1]) ? `${path[1]}-group` : path[1];
  };
  const groups = [...new Set(entries.map(groupOf))];
  const files = {};
  const dir = `src/areas/${area}`;
  const AreaVar = `${camel(area)}Area`;
  // Flags on the area's group (`bitbucket --project --repo`) are its context
  // inputs, declared once on the area; core puts them on the group and on
  // every MCP tool. Where each value comes from is the port's to fill in.
  const groupOptions = contract.commands.find((c) => c.command === area)?.options ?? [];
  const contextBlock = groupOptions.length
    ? [
        '  // TODO: for each, the connection `setting` that supplies it, a `git` reader if the remote names it,',
        '  // and `selectsConnection: true` where the value picks the connection (--instance, --env).',
        '  context: {',
        ...groupOptions.map((o) => `    ${fieldOf(o.flags)}: { description: ${quote(o.description || o.flags)}, flags: ${quote(o.flags)} },`),
        '  },',
        '',
      ].join('\n')
    : '';

  files[`${dir}/area.ts`] = `import { z } from 'zod';
import { defineArea } from '${core}/area.js';
import { ToilError } from '${core}/errors.js';
import type { SupportedVersion } from '${core}/supported.js';

/**
 * TODO: one line on what ${area} is, and a dry one about what it replaces
 * (CLAUDE.md, Code Comments). Stubbed from docs/command-contract.json.
 */
export const ${AreaVar} = defineArea({
  name: ${quote(area)},
  description: 'TODO: what this area covers, in one line',
  // TODO: the predecessor's config keys, with the same names, so the env vars match (TOIL_${area.toUpperCase().replace(/-/g, '_')}_*).
  connection: z.object({
    baseUrl: z.url().describe('Server root, e.g. https://${area}.imagile.dev'),
    token: z.string().min(1).describe('TODO: the credential the Authentication Bar allows'),
  }),
  secrets: ['token'],
${contextBlock}});

/** TODO: from the area's brief (docs/briefs/${area}.md); minimum: null until it's established. */
export const ${camel(area)}Supported: SupportedVersion = { product: 'TODO', minimum: null };

/** Thrown by every stub until its command is ported. */
export function notPorted(command: string): never {
  throw new ToilError('INTERNAL', \`toil \${command} is stubbed and not ported yet.\`, { fix: 'Port it from the predecessor before shipping.' });
}
`;

  for (const group of groups) {
    const list = entries.filter((c) => groupOf(c) === group);
    const anyWrites = list.some((c) => WRITE_VERBS.test(c.command.split(' ').at(-1)));
    files[`${dir}/${group}.ts`] = [
      `import { z } from 'zod';`,
      ...(anyWrites ? [`import { allowWriteField } from '${core}/run.js';`] : []),
      `import { ${AreaVar}, notPorted } from './area.js';`,
      ``,
      `/** TODO: what these commands share, and one dry line. Stubbed from docs/command-contract.json. */`,
      ``,
      list.map((c) => commandSource(c, area, new Set(groupOptions.map((o) => fieldOf(o.flags))))).join('\n\n'),
      ``,
      `export const ${camel(group)}Commands = [${list.map((c) => exportName(c.command)).join(', ')}];`,
      ``,
    ].join('\n');
  }

  files[`${dir}/index.ts`] = [
    `import { ${AreaVar}, ${camel(area)}Supported } from './area.js';`,
    ...groups.map((g) => `import { ${camel(g)}Commands } from './${g}.js';`),
    ``,
    `// Registered by existing: scripts/gen-areas.mjs finds this file.`,
    `export const area = ${AreaVar};`,
    `export const supported = ${camel(area)}Supported;`,
    `export const commands = [${groups.map((g) => `...${camel(g)}Commands`).join(', ')}];`,
    ``,
  ].join('\n');

  files[`test/fixtures/${area}.fixture.ts`] = `import { defineFixture } from '../harness/fixtures.js';

/**
 * Canned ${area} responses for every request the examples send. Say which
 * shapes came from the predecessor's tests and which were invented from the
 * vendor's docs. Routes match on method, path and query.
 */
export const fixture = defineFixture({
  area: ${quote(area)},
  routes: [
    // { path: '/api/thing', query: { id: '1' }, respond: { json: { id: '1' } } },
  ],
  config: { ${area.includes('-') ? quote(area) : area}: { baseUrl: 'https://${area}.imagile.dev', token: 'test-token', writes: true } },
});
`;

  files[`skills/toil/${area}.md`] = `---
area: ${area}
description: TODO what the area covers, in one line with no colon and space
---

# TODO service name (\`${area}\`)

TODO: what it covers. Verification level: \`unit\`.

**Supported versions:** TODO, worded exactly as \`supportedText()\` in src/core/supported.ts words the area's \`supported\`.

## Credential

TODO: what it is, where to create it, and how toil sends it.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| \`baseUrl\` | \`TOIL_${area.toUpperCase().replace(/-/g, '_')}_BASE_URL\` | yes | Server root, e.g. \`https://${area}.imagile.dev\` |

## Commands

${entries.map((c) => `- \`${c.command.split(' ').slice(1).join(' ')}\`: ${c.description || 'TODO'}`).join('\n')}
`;
  return files;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [area, flag] = process.argv.slice(2);
  if (!area) {
    console.error('usage: node scripts/stub-area.mjs <area> [--dry]');
    process.exit(2);
  }
  const contract = JSON.parse(readFileSync(join(root, 'docs', 'command-contract.json'), 'utf8'));
  const files = stubFiles(contract, area, { removed: removedPaths(join(root, 'docs', 'divergences')) });
  const clash = Object.keys(files).filter((p) => existsSync(join(root, p)));
  if (clash.length > 0) {
    console.error(`Refusing to overwrite: ${clash.join(', ')}`);
    process.exit(1);
  }
  for (const [path, content] of Object.entries(files)) {
    if (flag === '--dry') {
      console.log(path);
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
    console.log(`wrote ${path}`);
  }
  if (flag !== '--dry') {
    console.log(`\nNext: read docs/briefs/${area}.md, set status "unit" in site/src/data/integrations/${area}.json, then port each command (integrations skill).`);
  }
}
