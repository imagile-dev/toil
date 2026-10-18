// The triage agent holds no GitHub write access. It writes what it decided to
// .triage-out/ (decision.json, comment.md, and for a fix pr-title.txt and
// pr-body.md), and the workflow's last job applies it with its own token after
// checking it here. The agent proposes; the form is checked; a clerk stamps it.
//
// decision.json: { "decision": "fix" | "deny" | "duplicate", "areas": ["jira"], "duplicateOf": 12 }
//
//   node scripts/triage/decision.mjs <out-dir> <issue> <area>...   writes the checked
//   decision to $GITHUB_OUTPUT and the comment and PR text, defused, beside it.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_COMMENT = 8000;
const MAX_BODY = 60000;

/**
 * Turns every closing reference GitHub honours (any case; `#N`, `owner/repo#N`,
 * an issue URL; with or without a colon) into plain text, so only the issue the
 * workflow names itself closes when the PR merges.
 */
export function defuseClosingKeywords(text) {
  return text.replace(
    /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(\s*:?\s+)((?:[\w.-]+\/[\w.-]+)?#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:issues|pull)\/\d+)/gi,
    (_, keyword, _space, ref) => `${keyword} (see ${ref})`,
  );
}

/** Stops agent-written text from pinging accounts. */
export const quietMentions = (text) => text.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, '$1@​');

/**
 * Whether the agent ran at all. The agent's job writes `agent-ok` beside its files
 * only when the agent step succeeded; with that marker or decision.json missing,
 * the agent didn't run, failed, or was refused by the action. That is no decision
 * about the issue: the workflow leaves it queued, says nothing on it, and fails the
 * run where a maintainer sees it. The output `decision` is then `failed`, as
 * opposed to `invalid`, a decision the agent made that parseDecision refuses.
 */
export function agentRan(files) {
  return files.includes('agent-ok') && files.includes('decision.json');
}

/** Checks the agent's decision; returns { ok, decision, areas, duplicateOf, problems }. */
export function parseDecision(raw, issue, knownAreas) {
  const problems = [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, problems: ['decision.json is missing or not JSON'] };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return { ok: false, problems: ['decision.json is not an object'] };
  const decision = value.decision;
  if (!['fix', 'deny', 'duplicate'].includes(decision)) problems.push(`decision must be fix, deny or duplicate, not ${JSON.stringify(decision)}`);
  const areas = Array.isArray(value.areas) ? [...new Set(value.areas)] : [];
  if (!Array.isArray(value.areas)) problems.push('areas must be a list');
  const unknown = areas.filter((a) => typeof a !== 'string' || !knownAreas.includes(a));
  if (unknown.length) problems.push(`unknown areas: ${unknown.map(String).join(', ')}`);
  if (areas.length > 5) problems.push('more than five areas');
  let duplicateOf;
  if (decision === 'duplicate') {
    duplicateOf = value.duplicateOf;
    if (!Number.isInteger(duplicateOf) || duplicateOf < 1 || duplicateOf === issue) problems.push('duplicateOf must be another issue number');
  }
  return { ok: problems.length === 0, decision, areas: unknown.length ? [] : areas, duplicateOf, problems };
}

const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '');

/**
 * Reads the agent's handover in `dir` and returns the outputs finish acts on
 * (`decision`, and for a decision `labels` and `duplicate_of`), writing the
 * checked comment and PR text beside the inputs for --body-file.
 */
export function decide(dir, issue, areas, log = console.log) {
  if (!agentRan(['agent-ok', 'decision.json'].filter((name) => existsSync(join(dir, name))))) {
    log(`The agent didn't run to completion for #${issue}: there is no decision to apply.`);
    return { decision: 'failed' };
  }
  const parsed = parseDecision(readText(join(dir, 'decision.json')), issue, areas);
  if (!parsed.ok) log(`The agent's decision was refused: ${parsed.problems.join('; ')}`);
  writeFileSync(join(dir, 'comment.checked.md'), quietMentions(readText(join(dir, 'comment.md')).slice(0, MAX_COMMENT)).trim() || 'Triaged.');
  // eslint-disable-next-line no-control-regex
  const title = readText(join(dir, 'pr-title.txt')).split('\n')[0].replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 120);
  writeFileSync(join(dir, 'pr-title.checked.txt'), title || `Triage fix for #${issue}`);
  writeFileSync(join(dir, 'pr-body.checked.md'), quietMentions(defuseClosingKeywords(readText(join(dir, 'pr-body.md')).slice(0, MAX_BODY))));
  return {
    decision: parsed.ok ? parsed.decision : 'invalid',
    labels: ['triaged', ...(parsed.ok && parsed.decision !== 'fix' ? ['denied'] : []), ...(parsed.areas ?? []).map((a) => `area:${a}`)].join(','),
    duplicate_of: parsed.ok && parsed.duplicateOf ? String(parsed.duplicateOf) : '',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, issueArg, ...areas] = process.argv.slice(2);
  const issue = Number(issueArg);
  if (!dir || !Number.isInteger(issue) || issue < 1) {
    console.error('Usage: decision.mjs <out-dir> <issue> <area>...');
    process.exit(1);
  }
  const outputs = decide(dir, issue, areas);
  for (const [key, value] of Object.entries(outputs)) {
    const line = `${key}=${value}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
    else process.stdout.write(line);
  }
}
