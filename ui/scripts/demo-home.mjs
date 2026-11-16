// Builds the clean demo home Toil UI and the toil CLI are recorded in:
//
//   node ui/scripts/demo-home.mjs                 # ~/toil-demo-home
//   node ui/scripts/demo-home.mjs --home <dir> --fresh
//
// In <home> it writes:
//   - .toil/config.json: a copy of your ~/.toil/config.json with writes turned
//     off on every connection. Secrets in it are keychain: references only, so
//     the tokens stay in the OS credential store; a plaintext one stops the run.
//     It adds a `github` connection with no token (launch with TOIL_GITHUB_TOKEN
//     from gh auth token, see docs/demo-reset.md) and a `ledger` SQLite one.
//   - ledger.db: a made-up ledger of 6 merchants, 60 settlements and 12
//     chargebacks, built with node:sqlite and the same every time (seeded).
//   - the toil project `payments-team`, made with toil's own projects commands,
//     tying Jira SCRUM, GitHub imagile-dev/toil-sandbox, Azure DevOps "Toil
//     Sandbox" and the ledger together.
// Repo tooling only: nothing here ships. A clean desk, set up for the camera,
// as is traditional.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const args = process.argv.slice(2);
const take = (flag, fallback) => {
  const at = args.indexOf(flag);
  return at >= 0 ? args.splice(at, 2)[1] : fallback;
};
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? (args.splice(at, 1), true) : false;
};
const home = resolve(take('--home', join(homedir(), 'toil-demo-home')));
const fresh = flag('--fresh');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const toilJs = resolve(take('--toil', join(root, 'dist', 'toil.js')));
if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'Use --home <dir>, --fresh and --toil <path>.');
if (home === homedir()) fail('The demo home must not be your real home.', 'Pick another folder with --home.');

function fail(message, fix) {
  process.stderr.write(`demo-home: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}
const say = (line) => process.stdout.write(`${line}\n`);

if (fresh) rmSync(home, { recursive: true, force: true });
mkdirSync(join(home, '.toil'), { recursive: true });
// macOS's `security` finds the login keychain under $HOME/Library, so a home with
// another HOME needs the real Keychains folder linked in, or every keychain:
// reference reads as missing. Windows and Linux stores don't go by HOME.
if (process.platform === 'darwin' && !existsSync(join(home, 'Library', 'Keychains'))) {
  mkdirSync(join(home, 'Library'), { recursive: true });
  symlinkSync(join(homedir(), 'Library', 'Keychains'), join(home, 'Library', 'Keychains'));
}

// Config: a copy with writes off, keychain references only ------------------------------
const realConfig = join(homedir(), '.toil', 'config.json');
if (!existsSync(realConfig)) fail(`There is no ${realConfig}.`, 'Add the jira and ado connections first (docs/demo-reset.md).');
const config = JSON.parse(readFileSync(realConfig, 'utf8'));
config.version ??= 2;
config.connections ??= {};
const SECRET_KEYS = ['apiToken', 'pat', 'token', 'password', 'apiKey'];
for (const [name, conn] of Object.entries(config.connections)) {
  for (const key of SECRET_KEYS) {
    if (typeof conn[key] === 'string' && !conn[key].startsWith('keychain:')) fail(`Connection ${name} holds a plaintext ${key}.`, `Run toil connections login ${name} so it becomes a keychain: reference.`);
  }
  conn.writes = false;
}
config.connections.github ??= { area: 'github', baseUrl: 'https://api.github.com' };
config.connections.github.writes = false;
const ledgerPath = join(home, 'ledger.db');
config.connections.ledger = { area: 'db', engine: 'sqlite', path: ledgerPath.replaceAll('\\', '/'), writes: false };
writeFileSync(join(home, '.toil', 'config.json'), JSON.stringify(config, null, 2) + '\n');
say(`config: ${Object.keys(config.connections).join(', ')} (writes off on all)`);

// The ledger ----------------------------------------------------------------------------
rmSync(ledgerPath, { force: true });
const db = new DatabaseSync(ledgerPath);
db.exec(`
  CREATE TABLE merchants (id INTEGER PRIMARY KEY, name TEXT NOT NULL, country TEXT NOT NULL, risk TEXT NOT NULL);
  CREATE TABLE settlements (id INTEGER PRIMARY KEY, merchant_id INTEGER NOT NULL REFERENCES merchants(id), settled_on TEXT NOT NULL, currency TEXT NOT NULL, amount_minor INTEGER NOT NULL, status TEXT NOT NULL);
  CREATE TABLE chargebacks (id INTEGER PRIMARY KEY, settlement_id INTEGER NOT NULL REFERENCES settlements(id), opened_on TEXT NOT NULL, reason TEXT NOT NULL, amount_minor INTEGER NOT NULL, status TEXT NOT NULL);
`);
let seed = 43;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const merchants = [
  ['Northwind Coffee', 'US', 'low'], ['Fjord Outdoor', 'NO', 'low'], ['Sakura Stationery', 'JP', 'medium'],
  ['Lumen Games', 'GB', 'high'], ['Harbor Books', 'US', 'low'], ['Seoul Street Eats', 'KR', 'medium'],
];
const currency = { US: 'USD', NO: 'NOK', JP: 'JPY', GB: 'GBP', KR: 'KRW' };
const addMerchant = db.prepare('INSERT INTO merchants (id, name, country, risk) VALUES (?, ?, ?, ?)');
merchants.forEach(([name, country, risk], i) => addMerchant.run(i + 1, name, country, risk));
const addSettlement = db.prepare('INSERT INTO settlements (id, merchant_id, settled_on, currency, amount_minor, status) VALUES (?, ?, ?, ?, ?, ?)');
const day = 24 * 60 * 60 * 1000;
for (let i = 1; i <= 60; i++) {
  const m = 1 + Math.floor(rnd() * merchants.length);
  const date = new Date(Date.now() - Math.floor(rnd() * 30) * day).toISOString().slice(0, 10);
  addSettlement.run(i, m, date, currency[merchants[m - 1][1]], 5000 + Math.floor(rnd() * 500000), i > 54 ? 'pending' : 'paid');
}
const addChargeback = db.prepare('INSERT INTO chargebacks (id, settlement_id, opened_on, reason, amount_minor, status) VALUES (?, ?, ?, ?, ?, ?)');
for (let i = 1; i <= 12; i++) {
  const date = new Date(Date.now() - Math.floor(rnd() * 20) * day).toISOString().slice(0, 10);
  addChargeback.run(i, 1 + Math.floor(rnd() * 60), date, pick(['fraudulent', 'product_not_received', 'duplicate', 'requested_by_customer']), 1000 + Math.floor(rnd() * 40000), i <= 7 ? 'open' : pick(['won', 'lost']));
}
db.close();
say(`ledger: ${ledgerPath} (6 merchants, 60 settlements, 12 chargebacks)`);

// The toil project ------------------------------------------------------------------------
const toil = (...argv) => {
  const res = spawnSync(process.execPath, [toilJs, ...argv], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  try {
    return JSON.parse(res.stdout);
  } catch {
    return fail(`toil ${argv.slice(0, 3).join(' ')} printed no envelope: ${(res.stderr || res.stdout).trim().slice(0, 300)}`, 'Run it by hand.');
  }
};
const must = (env, what) => env.ok || fail(`${what}: ${env.error.message}`, env.error.fix ?? 'Run it by hand.');
const P = 'payments-team';
if (!toil('projects', 'show', P).ok) must(toil('projects', 'init', P, '--description', 'Kettlewell payments: Checkout (Jira), Platform (GitHub) and Settlement (Azure DevOps), with the read replica (made-up demo data)'), 'projects init');
must(toil('projects', 'add-repo', P, 'https://github.com/imagile-dev/toil-sandbox', '--name', 'toil-sandbox', '--replace'), 'projects add-repo');
must(toil('projects', 'link', P, 'github', '--connection', 'github', '--set', 'owner=imagile-dev', '--set', 'repo=toil-sandbox', '--replace'), 'projects link github');
if (config.connections.jira) must(toil('projects', 'link', P, 'jira', '--connection', 'jira', '--set', 'project=SCRUM', '--replace'), 'projects link jira');
if (config.connections.ado) must(toil('projects', 'link', P, 'ado', '--connection', 'ado', '--set', 'project=Toil Sandbox', '--replace'), 'projects link ado');
// The Postgres replica (demo-postgres.mjs) when it's configured, else the SQLite ledger.
must(toil('projects', 'link', P, 'db', '--connection', config.connections['payments-db'] ? 'payments-db' : 'ledger', '--replace'), 'projects link db');
if (config.connections.confluence) must(toil('projects', 'link', P, 'confluence', '--connection', 'confluence', '--set', 'space=KW', '--replace'), 'projects link confluence');
if (config.connections.figma) must(toil('projects', 'link', P, 'figma', '--connection', 'figma', '--replace'), 'projects link figma');
const check = toil('projects', 'check', P);
say(`toil project ${P}: ${check.ok && check.data?.ok !== false ? 'checks out' : `check says ${JSON.stringify(check.data?.problems ?? check.error)}`}`);
say(`demo home ready: ${home}`);
