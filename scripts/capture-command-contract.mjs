// Recapture docs/command-contract.json from a built copy of the command contract.
// Walks its --help output recursively, so it records what Commander actually
// registered rather than what the source appears to say. With --source, it
// also reads the contract's TypeScript and records each command's output
// field names (contract-output.mjs), which --help can't show.
//
//   node scripts/capture-command-contract.mjs <repo>/dist/cli.js --source <repo> > docs/command-contract.json
//
// <repo> is a checkout of the contract at the captured version, built, with
// its node_modules installed so the checker can resolve its types. The CLI's
// name, package and version come from the package.json next to it, so the
// contract is named only in the captured contract, never here.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { captureOutput } from './contract-output.mjs';
const args = process.argv.slice(2);
const sourceAt = args.indexOf('--source');
const source = sourceAt >= 0 ? args.splice(sourceAt, 2)[1] : undefined;
const [cli] = args;
if (!cli) {
  console.error('usage: capture-command-contract.mjs <path/to/dist/cli.js> [--source <repo>]');
  process.exit(2);
}
const pkg = JSON.parse(readFileSync(join(dirname(cli), '..', 'package.json'), 'utf8'));
const binName = Object.keys(typeof pkg.bin === 'object' ? pkg.bin : { [pkg.name]: pkg.bin })[0];
const help = (path) => execFileSync(process.execPath, [cli, ...path, '--help'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', COLUMNS: '400' } });

function section(text, name) {
  const m = text.split(/\r?\n/);
  const i = m.findIndex((l) => l.trim() === `${name}:`);
  if (i < 0) return [];
  const out = [];
  for (let j = i + 1; j < m.length; j++) {
    const l = m[j];
    if (!l.trim()) break;
    if (/^\S/.test(l)) break;
    if (/^ {2}\S/.test(l)) out.push(l.trim());
    else if (out.length) out[out.length - 1] += ' ' + l.trim();
  }
  return out;
}

const split = (line) => { const m = line.match(/^(.+?)(?:\s{2,}(.*))?$/); return [m[1].trim(), (m[2] || '').trim()]; };

const result = [];
const seen = new Set();
function walk(path) {
  if (path.length > 6) throw new Error('too deep: ' + path.join(' '));
  const text = help(path);
  const usageLine = (text.match(/^Usage: .*$/m) || [''])[0];
  if (path.length && seen.has(usageLine)) throw new Error('help did not change at ' + path.join(' '));
  seen.add(usageLine);
  const usage = (text.match(/^Usage: \S+ (.*)$/m) || [])[1] || '';
  const options = section(text, 'Options').map(split).filter(([f]) => !/^-h, --help$/.test(f)).map(([flags, description]) => ({ flags, description }));
  const subs = section(text, 'Commands').map(split).filter(([c]) => !c.startsWith('help '));
  if (path.length) result.push({ command: path.join(' '), usage: usage.replace(/^.*?(\[options\]|<|\[|$)/, '$1').trim(), description: (text.split(/\r?\n/).find((l, i, a) => i > 0 && a[i - 1] === '' && l.trim() && !l.startsWith('Usage')) || '').trim(), options, leaf: subs.length === 0 });
  else result.push({ command: '', usage: 'global', options, leaf: false });
  for (const [c] of subs) {
    const [name, ...aliases] = c.split(/\s/)[0].split('|');
    const at = result.length;
    walk([...path, name]);
    if (aliases.length) result[at].aliases = aliases;
  }
}
walk([]);
const output = source ? captureOutput(source) : new Map();

const contract = {
  _readme: 'Frozen command surface of the command contract, captured from its own --help output. toil must match every integration command here; see docs/command-contract.md for scope and the listed divergences. Do not edit by hand; recapture instead.',
  _output:
    'output lists the data shapes a command returns, one entry per place in the source that returns: field paths two levels deep, [] for an array element, a trailing ? for an optional field. opaque means the source types the data as any or unknown (usually a server response passed through), so there are no names to check.',
  source: {
    name: binName,
    package: pkg.name,
    version: pkg.version,
    capturedAt: new Date().toISOString().slice(0, 10),
    method: `recursive --help walk of the built CLI${source ? '; output fields from the TypeScript checker over its source' : ''}`,
  },
  globalOptions: result[0].options,
  commands: result.slice(1).map(({ command, usage, description, aliases, options, leaf }) => ({
    command,
    usage,
    description,
    ...(aliases ? { aliases } : {}),
    leaf,
    options,
    ...(leaf && output.has(command) ? { output: output.get(command) } : {}),
  })),
};
process.stdout.write(`${JSON.stringify(contract, null, 2)}\n`);
