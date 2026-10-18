// Every step of .github/workflows/triage.yml that does more than wire inputs to
// outputs, as one function each, so the wiring is tested here instead of being
// discovered in a run. The YAML passes inputs as env vars (never interpolated
// into a script) and reads the outputs these write to $GITHUB_OUTPUT.
//
//   node scripts/triage/steps.mjs <step>
//
// Each step takes { env, fetcher, log } and returns its outputs; the CLI writes
// them to $GITHUB_OUTPUT. OUTPUTS lists what each step can write, and
// test/workflow-wiring.test.ts holds the YAML to it. Three rounds of review found
// wiring bugs no unit test could see, which is three more than a form ought to
// need before someone checks the boxes are connected.

import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { extract, inspect } from './archive.mjs';
import { CLAIMED, QUEUED, claim, drain, gh } from './cap.mjs';
import { check } from './changes.mjs';
import { decide } from './decision.mjs';
import { areas } from './labels.mjs';
import { parseTerms, redact } from './redact.mjs';

/** What each step may write to $GITHUB_OUTPUT. */
export const OUTPUTS = {
  select: ['issues'],
  redact: [],
  prepare: ['fenced', 'nonce', 'areas', 'handover_sha'],
  decide: ['decision', 'labels', 'duplicate_of'],
  requeue: [],
  'open-pr': ['url'],
  apply: [],
};

const options = (env, fetcher) => ({ fetcher, token: env.GH_TOKEN });
const repoOf = (env) => {
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) throw new Error('GITHUB_REPOSITORY must be owner/name.');
  return env.GITHUB_REPOSITORY;
};
const issueOf = (value, name) => {
  if (!/^[1-9]\d*$/.test(String(value ?? '').trim())) throw new Error(`${name} is empty or not an issue number.`);
  return Number(value);
};

/** Parses the issue list one job hands the next; empty or missing is an empty list, anything else is refused. */
export function parseIssues(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return [];
  const list = JSON.parse(text);
  if (!Array.isArray(list) || list.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`Not a list of issue numbers: ${text}`);
  return list;
}

/** select: which issues this run triages. A label event claims within the cap; the schedule drains the queue; a dispatch is a re-triage. */
export async function select({ env, fetcher = fetch, log = console.log }) {
  const repo = repoOf(env);
  const cap = Number(env.TRIAGE_CAP ?? '4');
  if (env.EVENT === 'issues') {
    const issue = issueOf(env.ISSUE, 'ISSUE');
    const result = await claim(repo, issue, cap, options(env, fetcher));
    log(`#${issue}: ${result.reason}`);
    return { issues: JSON.stringify(result.run ? [issue] : []) };
  }
  if (env.EVENT === 'workflow_dispatch') {
    const issue = issueOf(env.DISPATCHED, 'The dispatched issue');
    log(`A manual re-triage of #${issue}, not counted against the cap.`);
    return { issues: JSON.stringify([issue]) };
  }
  if (env.EVENT === 'schedule') {
    const issues = await drain(repo, cap, options(env, fetcher));
    log(issues.length ? `Triaging from the queue: ${issues.map((n) => `#${n}`).join(', ')}` : 'Nothing to triage from the queue today.');
    return { issues: JSON.stringify(issues) };
  }
  throw new Error(`Triage doesn't run on ${env.EVENT ?? 'an unnamed event'}.`);
}

/** redact: rewrites each claimed issue's title and body in place before anything else reads them. */
export async function redactIssues({ env, fetcher = fetch, log = console.log }) {
  const repo = repoOf(env);
  const terms = parseTerms(env.REDACT_TERMS ?? '');
  if (terms.invalid) log(`::warning::${terms.invalid} REDACT_TERMS entries were refused (they would match the redactor's own markers).`);
  for (const number of parseIssues(env.ISSUES)) {
    const issue = await gh('GET', `/repos/${repo}/issues/${number}`, undefined, options(env, fetcher));
    const title = redact(issue.title ?? '', terms);
    const body = redact(issue.body ?? '', terms);
    if (title !== (issue.title ?? '') || body !== (issue.body ?? '')) {
      await gh('PATCH', `/repos/${repo}/issues/${number}`, { title, body }, options(env, fetcher));
      log(`Redacted #${number} in place.`);
    }
  }
  return {};
}

const EXCLUDED = new Set(['.git', 'node_modules', '.triage-out', '.triage-in']);

/**
 * prepare: everything the agent reads, made before it starts by main's code: the
 * issue (redacted again, in case it changed since select) fenced with a nonce,
 * the repository's issues for the duplicate check, the area list, a pristine copy
 * of the tree, and the handover script copied out with its hash.
 */
export async function prepare({ env, fetcher = fetch, cwd = process.cwd() }) {
  const repo = repoOf(env);
  const number = issueOf(env.NUMBER, 'NUMBER');
  const temp = env.RUNNER_TEMP;
  if (!temp) throw new Error('RUNNER_TEMP is not set.');
  const terms = parseTerms(env.REDACT_TERMS ?? '');
  const issue = await gh('GET', `/repos/${repo}/issues/${number}`, undefined, options(env, fetcher));
  const list = [];
  for (let page = 1; page <= 5; page++) {
    const batch = await gh('GET', `/repos/${repo}/issues?state=all&per_page=100&page=${page}`, undefined, options(env, fetcher));
    for (const i of batch) {
      if (!i.pull_request) list.push({ number: i.number, title: redact(i.title ?? '', terms), state: i.state, stateReason: i.state_reason ?? null, labels: (i.labels ?? []).map((l) => l.name) });
    }
    if (batch.length < 100) break;
  }
  mkdirSync(join(cwd, '.triage-in'), { recursive: true });
  mkdirSync(join(cwd, '.triage-out'), { recursive: true });
  writeFileSync(join(cwd, '.triage-in', 'issues.json'), `${JSON.stringify(list, null, 1)}\n`);
  // A fence nobody can guess, so text inside it can't close it early.
  const nonce = randomBytes(12).toString('hex');
  const strip = (text) => text.replace(/\r/g, '').split('\n').filter((line) => !line.includes(nonce)).join('\n');
  const fenced = [`BEGIN UNTRUSTED ${nonce}`, `Title: ${strip(redact(issue.title ?? '', terms))}`, '', strip(redact(issue.body ?? '', terms)), `END UNTRUSTED ${nonce}`].join('\n');
  // The tree as main has it, so the handover can tell what the agent changed without running git.
  cpSync(cwd, join(temp, 'pristine'), { recursive: true, filter: (source) => !relative(cwd, source).split(sep).some((part) => EXCLUDED.has(part)) });
  // The handover runs after the agent, from a copy made now; finish checks the
  // hash before running it, so an edit to it during the agent's turn stops the job.
  const script = readFileSync(join(cwd, 'scripts', 'triage', 'handover.sh'));
  writeFileSync(join(temp, 'handover.sh'), script);
  return { fenced, nonce, areas: areas(join(cwd, 'src', 'areas')).join(' '), handover_sha: createHash('sha256').update(script).digest('hex') };
}

/** decide: the agent's decision as finish acts on it (scripts/triage/decision.mjs). */
export async function decideStep({ env, cwd = process.cwd(), log = console.log }) {
  const dir = env.HANDOVER;
  if (!dir) throw new Error('HANDOVER is not set.');
  mkdirSync(dir, { recursive: true });
  return decide(dir, issueOf(env.NUMBER, 'NUMBER'), areas(join(cwd, 'src', 'areas')), log);
}

/** requeue: the agent never decided, so the issue goes back in the queue with no comment and no label. */
export async function requeue({ env, fetcher = fetch }) {
  const repo = repoOf(env);
  const number = issueOf(env.NUMBER, 'NUMBER');
  await gh('POST', `/repos/${repo}/issues/${number}/labels`, { labels: [QUEUED] }, options(env, fetcher));
  await gh('DELETE', `/repos/${repo}/issues/${number}/labels/${CLAIMED}`, undefined, options(env, fetcher));
  return {};
}

const git = (cwd, args, extraEnv = {}) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...extraEnv } });
  if (run.error || run.status !== 0) throw new Error(`git ${args[0]} failed: ${run.error?.message ?? run.stderr.trim()}`);
  return run.stdout;
};

/**
 * open-pr: the fix as a draft PR. Every path is checked by main's scripts before
 * a byte lands, and again on the commit; nothing in the fix is run.
 */
export async function openPr({ env, fetcher = fetch, cwd = process.cwd(), log = console.log }) {
  const repo = repoOf(env);
  const number = issueOf(env.NUMBER, 'NUMBER');
  const dir = env.HANDOVER;
  const known = areas(join(cwd, 'src', 'areas'));
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : Buffer.alloc(0));
  const inspected = inspect(read('changes.tar'), read('deleted.txt').toString('utf8'), known);
  if (!inspected.ok) throw new Error(`The fix touches files triage may not:\n${inspected.refused.map((r) => `  - ${r}`).join('\n')}`);
  extract(inspected, cwd);
  const branch = `claude/issue-${number}`;
  git(cwd, ['checkout', '-q', '-b', branch]);
  git(cwd, ['add', '-A']);
  const raw = git(cwd, ['diff', '--cached', '--raw', '-z', '--no-renames']);
  const entries = raw.split('\0').filter(Boolean).reduce((acc, field, i, all) => (i % 2 === 0 ? [...acc, { path: all[i + 1], newMode: field.slice(1).split(' ')[1] }] : acc), []);
  const checked = check(entries, known);
  if (!checked.ok) throw new Error(`The commit touches files triage may not: ${checked.refused.join('; ')}`);
  const title = read('pr-title.checked.txt').toString('utf8').trim() || `Triage fix for #${number}`;
  git(cwd, ['-c', 'user.name=imagile-bot[bot]', '-c', 'user.email=imagile-bot[bot]@users.noreply.github.com', 'commit', '-q', '-m', title]);
  // The token reaches git through a credential helper reading env, never argv.
  const pushUrl = env.PUSH_URL ?? `https://github.com/${repo}.git`;
  git(cwd, ['-c', 'credential.helper=', '-c', 'credential.helper=!f() { echo username=x-access-token; echo "password=${GH_TOKEN}"; }; f', 'push', '--force', pushUrl, `HEAD:refs/heads/${branch}`], { GH_TOKEN: env.GH_TOKEN ?? '' });
  const body = [
    read('pr-body.checked.md').toString('utf8').trim(),
    '',
    `Closes #${number}`,
    '',
    "Opened as a draft by triage (`.github/workflows/triage.yml`) from a fix an agent proposed. Every changed path was checked against one area's own files. CI runs the full gate on this draft; a human marks it ready and merges it.",
  ].join('\n');
  const owner = repo.split('/')[0];
  const open = await gh('GET', `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`, undefined, options(env, fetcher));
  const pr = open[0]
    ? await gh('PATCH', `/repos/${repo}/pulls/${open[0].number}`, { title, body }, options(env, fetcher))
    : await gh('POST', `/repos/${repo}/pulls`, { title, body, head: branch, base: 'main', draft: true }, options(env, fetcher));
  await gh('POST', `/repos/${repo}/issues/${pr.number}/labels`, { labels: ['from-triage'] }, options(env, fetcher));
  log(`Draft PR: ${pr.html_url}`);
  return { url: pr.html_url };
}

/** apply: the comment, labels and closing the decision calls for. */
export async function apply({ env, fetcher = fetch }) {
  const repo = repoOf(env);
  const number = issueOf(env.NUMBER, 'NUMBER');
  const decision = env.DECISION;
  if (!['fix', 'deny', 'duplicate', 'invalid'].includes(decision)) throw new Error(`apply has nothing to do for decision ${JSON.stringify(decision)}.`);
  const dir = env.HANDOVER;
  let body = existsSync(join(dir, 'comment.checked.md')) ? readFileSync(join(dir, 'comment.checked.md'), 'utf8') : '';
  let labels = (env.LABELS ?? '').split(',').filter(Boolean);
  if (decision === 'fix') {
    body += env.PR_URL
      ? `\n\nProposed fix, as a draft pull request: ${env.PR_URL}. CI tests it; a maintainer reviews and merges it.\n`
      : `\n\nThe proposed change could not be made into a pull request (${env.RUN_URL}). A maintainer will look at it.\n`;
  }
  if (decision === 'invalid') {
    body = `Triage could not reach a valid decision (${env.RUN_URL}). A maintainer will look at it.\n`;
    labels = ['triaged'];
  }
  const o = options(env, fetcher);
  await gh('POST', `/repos/${repo}/issues/${number}/comments`, { body: body.trim() || 'Triaged.' }, o);
  await gh('POST', `/repos/${repo}/issues/${number}/labels`, { labels }, o);
  await gh('DELETE', `/repos/${repo}/issues/${number}/labels/${CLAIMED}`, undefined, o);
  if (decision === 'deny') await gh('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: 'not_planned' }, o);
  if (decision === 'duplicate') await gh('PATCH', `/repos/${repo}/issues/${number}`, { state: 'closed', state_reason: 'duplicate' }, o);
  return {};
}

export const STEPS = { select, redact: redactIssues, prepare, decide: decideStep, requeue, 'open-pr': openPr, apply };

/** Writes outputs to a GITHUB_OUTPUT file, multi-line values with a delimiter nothing in them can contain. */
export function writeOutputs(file, outputs) {
  for (const [key, value] of Object.entries(outputs)) {
    const text = String(value);
    if (!text.includes('\n')) appendFileSync(file, `${key}=${text}\n`);
    else {
      const delimiter = `EOF_${randomBytes(12).toString('hex')}`;
      appendFileSync(file, `${key}<<${delimiter}\n${text}\n${delimiter}\n`);
    }
  }
}

/** Reads a GITHUB_OUTPUT file back, as the runner does, for tests. */
export function readOutputs(text) {
  const out = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heredoc = /^([\w-]+)<<(.+)$/.exec(line);
    if (heredoc) {
      const end = lines.indexOf(heredoc[2], i + 1);
      out[heredoc[1]] = lines.slice(i + 1, end).join('\n');
      i = end;
    } else if (line.includes('=')) {
      out[line.slice(0, line.indexOf('='))] = line.slice(line.indexOf('=') + 1);
    }
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const name = process.argv[2];
  const step = STEPS[name];
  if (!step) {
    console.error(`Usage: steps.mjs <${Object.keys(STEPS).join('|')}>`);
    process.exit(1);
  }
  try {
    const outputs = await step({ env: process.env });
    if (process.env.GITHUB_OUTPUT) writeOutputs(process.env.GITHUB_OUTPUT, outputs);
    else console.log(JSON.stringify(outputs));
  } catch (error) {
    console.error(`::error::triage ${name}: ${error.message}`);
    process.exit(1);
  }
}
