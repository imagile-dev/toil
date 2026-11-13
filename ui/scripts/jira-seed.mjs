// Seeds a Jira test project with a handful of made-up issues that work
// classification can tell apart: dependency bumps, a security patch, an
// upgrade, audit paperwork, one already labelled `feature`, one whose title
// misleads the built-in signals, and one nothing settles. The project's other
// seeded issues are stories and tasks with no such tells, so without these a
// live `toil classify run` there says "unsure" forty-seven times.
//
//   node ui/scripts/jira-seed.mjs --project SCRUM --dry-run   # what it would create; sends no write
//   node ui/scripts/jira-seed.mjs --project SCRUM             # creates what's missing
//
// It writes through toil's own `jira issue create --allow-write`, so the
// connection's `writes` setting decides, and it never sees a token: toil reads
// that from the credential store. The project is always named on the command
// line, since a default connection can reach every project on the site. Each
// issue carries the labels `toil-seed` and `seed:<key>`, and one that already
// exists (found by its `seed:<key>` label) is left alone, so it is safe to run
// again. Repo tooling only: nothing here ships. A backlog groomed in advance,
// which is the only kind that ever is.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEED_LABEL = 'toil-seed';

/** The issues, by seed key. `labels` are added to the two seed labels. */
export const ISSUES = [
  { key: 'cls-bump', type: 'Task', summary: 'Bump spring-boot from 3.3.4 to 3.3.6', labels: ['dependencies'], description: 'The patch release fixes a connection pool leak under load. No behaviour change is expected.' },
  { key: 'cls-cve', type: 'Task', summary: 'Patch CVE-2026-31337 in the JWT verification library', labels: ['security'], description: 'The library accepts a token whose signature algorithm is "none". Upgrade to the fixed release and add a test for it.' },
  { key: 'cls-upgrade', type: 'Task', summary: 'Upgrade the settlement service to Java 21 before 17 leaves support', labels: [], description: 'Support for the current runtime ends next quarter. Nothing a merchant sees changes.' },
  { key: 'cls-audit', type: 'Task', summary: 'Quarterly PCI audit evidence for the card vault', labels: ['compliance'], description: 'Collect the access reviews and key rotation logs the auditor asks for each quarter.' },
  { key: 'cls-feature', type: 'Story', summary: 'Let merchants choose a weekly payout schedule', labels: ['feature'], description: 'Merchants can pick daily or weekly payouts on their settings page. Already labelled as new work.' },
  { key: 'cls-ambiguous', type: 'Story', summary: 'Upgrade the search cluster to enable typo tolerance', labels: [], description: 'The title opens with "Upgrade", so a title signal reads it as upkeep, but it exists to ship a new capability. A person should correct it.' },
  { key: 'cls-unsure', type: 'Story', summary: 'Show the settlement currency on the payout page', labels: [], description: 'Nothing here says whether this is new work or upkeep: no label, no parent and no telling title.' },
];

function fail(message, fix) {
  process.stderr.write(`jira-seed: ${message}\n  Fix: ${fix}\n`);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const at = args.indexOf(flag);
    return at >= 0 ? args.splice(at, 2)[1] : undefined;
  };
  const flag = (name) => {
    const at = args.indexOf(name);
    if (at < 0) return false;
    args.splice(at, 1);
    return true;
  };
  const project = take('--project');
  const connection = take('--connection');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const toil = resolve(take('--toil') ?? resolve(root, 'dist', 'toil.js'));
  const dryRun = flag('--dry-run');
  if (args.length) fail(`Unknown argument: ${args.join(' ')}`, 'Use --project <key>, and optionally --connection <name>, --toil <path to toil.js> and --dry-run.');
  if (!project || !/^[A-Z][A-Z0-9_]{1,19}$/.test(project)) fail('Name the test project with --project <key>.', 'node ui/scripts/jira-seed.mjs --project SCRUM --dry-run');
  if (!existsSync(toil)) fail(`There is no toil at ${toil}.`, 'Pass --toil <path to toil.js>, or run npm run build first.');

  /** One toil call, never through a shell; returns the envelope. */
  const run = (argv) => {
    const res = spawnSync(process.execPath, [toil, ...argv, ...(connection ? ['--connection', connection] : [])], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.error) fail(`couldn't run toil: ${res.error.message}`, 'Check the path given with --toil.');
    try {
      return JSON.parse(res.stdout);
    } catch {
      return fail(`toil ${argv.slice(0, 3).join(' ')} printed no envelope: ${(res.stderr || res.stdout).trim().slice(0, 300)}`, 'Run the same toil command by hand to see what it says.');
    }
  };
  const say = (line) => process.stdout.write(`${line}\n`);

  let created = 0;
  for (const issue of ISSUES) {
    const found = run(['jira', 'issue', 'search', '--jql', `project = ${project} AND labels = "seed:${issue.key}"`, '--limit', '5']);
    if (!found.ok) fail(`couldn't search ${project}: ${found.error.message}`, found.error.fix ?? 'Check the jira connection with toil connections test.');
    const existing = found.data.issues?.[0];
    if (existing) {
      say(`${existing.key} ${issue.summary.slice(0, 60)}: exists`);
      continue;
    }
    if (dryRun) {
      say(`would create ${issue.type} "${issue.summary}" with labels ${[SEED_LABEL, `seed:${issue.key}`, ...issue.labels].join(', ')}`);
      continue;
    }
    const made = run(['jira', 'issue', 'create', '--project', project, '--type', issue.type, '--summary', issue.summary, '--description', issue.description, '--labels', [SEED_LABEL, `seed:${issue.key}`, ...issue.labels].join(','), '--allow-write']);
    if (!made.ok) fail(`couldn't create "${issue.summary}": ${made.error.message}`, made.error.fix ?? 'Check that the connection has writes on and that the project has this issue type.');
    created++;
    say(`${made.data.key} ${issue.summary.slice(0, 60)}: created`);
  }
  say(dryRun ? 'Dry run: nothing was sent.' : `Done: ${created} created, ${ISSUES.length - created} already there.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
