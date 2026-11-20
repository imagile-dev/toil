/**
 * Reading a standard: the file a team keeps one set of ticket rules in. A
 * standard may be checked in and handed to toil by anyone who can open a pull
 * request, and its rules reach an AI agent's prompt (as fenced data), so
 * nothing in it is taken on trust: shapes and lengths are checked, a value
 * shaped like a credential is refused, and control characters other than a
 * line break or a tab are refused. A file in the shape ticket rules had before
 * they became plain text (a `check`, `when`, `fail` or `missing` on a rule) is
 * refused with how to move it over, never half-read. The reader is pure (no
 * files), so the catalog, the commands and a test all read a standard one way.
 * A rule may say whatever the team likes; it may not say it at length.
 */
import type { Warning } from '../envelope.js';
import { ToilError } from '../errors.js';
import { findSecrets } from '../secret-shapes.js';
import { STANDARD_NAME, STANDARD_RULE_ID, type Standard, type StandardRule } from './types.js';

const TOP_KEYS = ['name', 'revision', 'description', 'rules'];
const RULE_KEYS = ['id', 'name', 'text'];
/** What a rule held while ticket rules were deterministic checks (#657): refused, never ignored, so an old file can't quietly lose its checks. */
const OLD_RULE_KEYS = ['check', 'when', 'fail', 'missing'];

/** The caps a standard is held to; docs/bounds.md has no row for them because they bound a file's content, not a path. */
export const STANDARD_LIMITS = {
  description: 300,
  rules: 50,
  ruleName: 120,
  ruleText: 2000,
} as const;

interface Problem {
  path: string;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A control character; `multiline` lets a line break and a tab through, which a rule's instructions may hold. */
const isControl = (s: string, multiline: boolean) =>
  [...s].some((c) => {
    const code = c.charCodeAt(0);
    if (multiline && (c === '\n' || c === '\r' || c === '\t')) return false;
    return code < 0x20 || code === 0x7f;
  });

/** Why a text can't go in a standard, or undefined when it can: within `max`, no credential shape, one line unless `multiline`. */
function textProblem(value: unknown, max: number, multiline = false): string | undefined {
  if (typeof value !== 'string') return 'must be text.';
  if (value.trim().length === 0) return 'must not be empty.';
  if (value.length > max) return `is ${value.length} characters; the most is ${max}.`;
  if (isControl(value, multiline)) return multiline ? 'must be plain text: line breaks and tabs are fine, other control characters are not.' : 'must be one line of text, with no line breaks or control characters.';
  if (findSecrets(value).length > 0) return 'holds something shaped like a credential, and a standard never holds one.';
  return undefined;
}

/** A rule's instructions as kept: line breaks as LF, trailing spaces off each line, blank lines at either end trimmed. */
const tidy = (text: string) =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .trim();

/**
 * Validates a parsed standard and returns it normalised, with defaults filled in
 * and texts trimmed. `where` names the file (or "the built-in standard") in the
 * error; the first problem is in the message and up to five are in `details`.
 */
export function readStandard(raw: unknown, where: string): { standard: Standard; warnings: Warning[] } {
  const problems: Problem[] = [];
  const warnings: Warning[] = [];
  const bad = (path: string, message: string) => problems.push({ path, message });
  const unknown = (at: string, key: string, takes: readonly string[], what: string) =>
    warnings.push({ code: 'STANDARD_UNKNOWN_KEY', message: `${where} (${at}): "${key}" isn't ${what} key; ${what.replace(/^an? /, 'a ')} takes ${takes.join(', ')}. It was ignored.` });
  const fail = (fix = `Fix it in ${where}; toil standards list --cwd <folder> reads it again.`): never => {
    const first = problems[0]!;
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more problem${problems.length > 2 ? 's' : ''})` : '';
    throw new ToilError('CONFIG_INVALID', `Standard ${where} can't be used${first.path ? `: ${first.path}` : ''}: ${first.message}${more}`, { fix, details: problems.slice(0, 5) });
  };
  if (!isRecord(raw)) {
    bad('', 'A standard must be a JSON object.');
    return fail();
  }

  // The old shape first, so its one clear message isn't buried under the problems it would also cause.
  if (Array.isArray(raw.rules)) {
    const old = raw.rules.flatMap((r: unknown, i: number) => (isRecord(r) ? OLD_RULE_KEYS.filter((k) => k in r).map((k) => `rules[${i}].${k}`) : []));
    if (old.length > 0) {
      bad(
        old[0]!,
        `this standard is in the shape ticket rules had when toil checked them itself (${old.slice(0, 3).join(', ')}${old.length > 3 ? ', …' : ''}). Ticket rules are now plain-text instructions an AI agent judges, so a rule holds only id, name and text.`,
      );
      return fail(`In ${where}, keep id, name and text on each rule, write what its check, when and fail said into its text in plain words ("For stories only: state the acceptance criteria as Given/When/Then scenarios."), and remove check, when, fail and missing. toil standards list shows the built-in rules as examples.`);
    }
  }

  for (const key of Object.keys(raw)) if (key !== '$schema' && !TOP_KEYS.includes(key)) unknown(key, key, TOP_KEYS, 'a standard');

  const name = raw.name;
  if (typeof name !== 'string' || !STANDARD_NAME.test(name)) bad('name', '"name" must be lowercase letters, digits and single hyphens, starting with a letter, e.g. "gherkin".');

  let revision = 1;
  if (raw.revision !== undefined) {
    if (typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision > 0) revision = raw.revision;
    else bad('revision', '"revision" must be a whole number above 0.');
  }

  let description: string | undefined;
  if (raw.description !== undefined) {
    const why = textProblem(raw.description, STANDARD_LIMITS.description);
    if (why) bad('description', `"description" ${why}`);
    else description = (raw.description as string).trim();
  }

  const rules: StandardRule[] = [];
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) bad('rules', `"rules" must be a list of 1 to ${STANDARD_LIMITS.rules} rules, each { id, name, text }.`);
  else {
    if (raw.rules.length > STANDARD_LIMITS.rules) bad('rules', `"rules" holds ${raw.rules.length}; the most is ${STANDARD_LIMITS.rules}.`);
    const seen = new Set<string>();
    raw.rules.forEach((r: unknown, i: number) => {
      const at = `rules[${i}]`;
      if (!isRecord(r)) return bad(at, 'Each rule must be an object { id, name, text }.');
      for (const key of Object.keys(r)) if (!RULE_KEYS.includes(key)) unknown(`${at}.${key}`, key, RULE_KEYS, 'a rule');
      let ok = true;
      const no = (path: string, message: string) => {
        ok = false;
        bad(path, message);
      };
      if (typeof r.id !== 'string' || !STANDARD_RULE_ID.test(r.id)) no(`${at}.id`, '"id" must be lowercase letters, digits and single hyphens, starting with a letter, up to 41 characters.');
      else if (seen.has(r.id)) no(`${at}.id`, `"${r.id}" is used by two rules.`);
      else seen.add(r.id);
      const nameWhy = textProblem(r.name, STANDARD_LIMITS.ruleName);
      if (nameWhy) no(`${at}.name`, `"name" ${nameWhy}`);
      const textWhy = textProblem(r.text, STANDARD_LIMITS.ruleText, true);
      if (textWhy) no(`${at}.text`, `"text" ${textWhy}`);
      if (ok) rules.push({ id: r.id as string, name: (r.name as string).trim(), text: tidy(r.text as string) });
    });
  }

  if (problems.length > 0) return fail();
  return { standard: { name: name as string, revision, ...(description !== undefined ? { description } : {}), rules }, warnings };
}

/** The file's text: a stable key order, two-space JSON, a trailing line feed. */
export function standardContent(standard: Standard): string {
  const { name, revision, description, rules } = standard;
  return `${JSON.stringify({ name, revision, ...(description !== undefined ? { description } : {}), rules: rules.map((r) => ({ id: r.id, name: r.name, text: r.text })) }, null, 2)}\n`;
}
