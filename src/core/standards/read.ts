/**
 * Reading a standard: the file a team keeps one set of ticket rules in. A
 * standard may be checked in and handed to toil by anyone who can open a pull
 * request, and its regular expressions run over text a tracker sent, so nothing
 * in it is taken on trust: shapes, lengths and one-line text are checked, a
 * value shaped like a credential is refused, and every pattern must compile,
 * stay short, and leave out the two constructions (backreferences and a
 * quantified group that holds a quantifier or an alternation) that let a
 * regular expression take exponential time. The reader is pure (no files), so
 * the catalog, the commands and a test all read a standard one way. A rule may
 * be as strict as the team likes; it may not be slow about it.
 */
import type { Warning } from '../envelope.js';
import { ToilError } from '../errors.js';
import { findSecrets } from '../secret-shapes.js';
import { readWhen } from '../classify/when.js';
import { CHECK_KINDS, STANDARD_NAME, STANDARD_RULE_ID, type CheckKind, type FailAs, type Place, type RuleCheck, type Standard, type StandardRule } from './types.js';

const TOP_KEYS = ['name', 'revision', 'description', 'rules'];
const RULE_KEYS = ['id', 'name', 'missing', 'text', 'when', 'fail', 'check'];
const CHECK_KEYS: Record<CheckKind, readonly string[]> = {
  pattern: ['kind', 'in', 'match', 'flags', 'labels'],
  section: ['kind', 'in', 'heading', 'minWords'],
  field: ['kind', 'in'],
  words: ['kind', 'in', 'min'],
  judge: ['kind', 'in'],
};

/** The caps a standard is held to; docs/bounds.md has no row for them because they bound a file's content, not a path. */
export const STANDARD_LIMITS = {
  description: 300,
  rules: 50,
  ruleName: 120,
  ruleText: 500,
  places: 5,
  patterns: 10,
  patternLength: 200,
  labelLength: 100,
  headings: 10,
  headingLength: 100,
  minWords: 1000,
  words: 10_000,
} as const;

/** A field a place names: an alias (`acceptanceCriteria`) or an id (`customfield_10042`, `Microsoft.VSTS.TCM.ReproSteps`). */
const FIELD_NAME = /^[A-Za-z0-9_][A-Za-z0-9_. :/-]{0,99}$/;
const PLAIN_PLACES = ['title', 'description', 'criteria'];

interface Problem {
  path: string;
  message: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** Why a text can't go in a standard, or undefined when it can: one line, within `max`, no credential shape. */
function textProblem(value: unknown, min: number, max: number): string | undefined {
  if (typeof value !== 'string') return 'must be text.';
  if (value.trim().length < min) return 'must not be empty.';
  if (value.length > max) return `is ${value.length} characters; the most is ${max}.`;
  // One line each: a rule's text reaches an AI agent's prompt, and a line break would let it pass as another instruction there.
  if (isControl(value)) return 'must be one line of text, with no line breaks or control characters.';
  if (findSecrets(value).length > 0) return 'holds something shaped like a credential, and a standard never holds one.';
  return undefined;
}

/**
 * Why a regular expression can't be a rule's pattern, or undefined when it can.
 * Refused: a backreference (`\1`, `\k<name>`), and a group that holds a
 * quantifier or an alternation and is itself repeated (`(a+)+`, `(a|ab)*`,
 * `(\w+\s?){2,}`), the shapes behind catastrophic backtracking. This errs on the
 * side of refusing: a pattern that needs such a group can almost always be
 * written without one.
 */
export function patternProblem(source: string): string | undefined {
  // Each open group: whether it holds a quantifier or an alternation.
  const stack: boolean[] = [false];
  const mark = () => {
    stack[stack.length - 1] = true;
  };
  /** The quantifier starting at `i`, if any: its length and whether it repeats (anything but `?`). */
  const quantifierAt = (i: number): { length: number; repeats: boolean } | undefined => {
    const c = source[i];
    if (c === '*' || c === '+') return { length: 1, repeats: true };
    if (c === '?') return { length: 1, repeats: false };
    if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(i));
      if (!m) return undefined;
      const repeats = m[2] !== undefined ? m[3] === '' || Number(m[3]) > 1 : Number(m[1]) > 1;
      return { length: m[0].length, repeats };
    }
    return undefined;
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (c === '\\') {
      const next = source[i + 1];
      if (next !== undefined && /[1-9]/.test(next)) return 'uses a backreference (\\1 to \\9), which can take exponential time; write the pattern without one.';
      if (next === 'k' && source[i + 2] === '<') return 'uses a named backreference (\\k<name>), which can take exponential time; write the pattern without one.';
      i += 2;
      continue;
    }
    if (c === '[') {
      // A character class is one atom; skip to its end, minding escapes and a leading ].
      let j = i + 1;
      if (source[j] === '^') j++;
      if (source[j] === ']') j++;
      while (j < source.length && source[j] !== ']') j += source[j] === '\\' ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (c === '(') {
      stack.push(false);
      i++;
      // A group's own prefix (?:, ?=, ?!, ?<=, ?<!, ?<name>) is not a quantifier.
      if (source[i] === '?') {
        const m = /^\?(?::|=|!|<=|<!|<[A-Za-z_][A-Za-z0-9_]*>)/.exec(source.slice(i));
        i += m ? m[0].length : 1;
      }
      continue;
    }
    if (c === ')') {
      const risky = stack.length > 1 ? stack.pop()! : false;
      i++;
      const q = quantifierAt(i);
      if (q?.repeats && risky) return 'repeats a group that itself holds a quantifier or an alternation (like (a+)+ or (a|ab)*), which can take exponential time; repeat a single character or class instead.';
      if (q || risky) mark();
      if (q) i += q.length;
      continue;
    }
    if (c === '|') {
      mark();
      i++;
      continue;
    }
    const q = quantifierAt(i);
    if (q) {
      mark();
      i += q.length;
      // A lazy or possessive suffix belongs to the quantifier.
      if (source[i] === '?') i++;
      continue;
    }
    i++;
  }
  return undefined;
}

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
  const fail = (): never => {
    const first = problems[0]!;
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more problem${problems.length > 2 ? 's' : ''})` : '';
    throw new ToilError('CONFIG_INVALID', `Standard ${where} can't be used${first.path ? `: ${first.path}` : ''}: ${first.message}${more}`, {
      fix: `Fix it in ${where}; toil standards list --cwd <folder> reads it again.`,
      details: problems.slice(0, 5),
    });
  };
  if (!isRecord(raw)) {
    bad('', 'A standard must be a JSON object.');
    return fail();
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
    const why = textProblem(raw.description, 1, STANDARD_LIMITS.description);
    if (why) bad('description', `"description" ${why}`);
    else description = (raw.description as string).trim();
  }

  const rules: StandardRule[] = [];
  if (!Array.isArray(raw.rules) || raw.rules.length === 0) bad('rules', `"rules" must be a list of 1 to ${STANDARD_LIMITS.rules} rules, each { id, name, text, when, fail, check }.`);
  else {
    if (raw.rules.length > STANDARD_LIMITS.rules) bad('rules', `"rules" holds ${raw.rules.length}; the most is ${STANDARD_LIMITS.rules}.`);
    const seen = new Set<string>();
    raw.rules.forEach((r: unknown, i: number) => {
      const at = `rules[${i}]`;
      if (!isRecord(r)) return bad(at, 'Each rule must be an object { id, name, text, when, fail, check }.');
      for (const key of Object.keys(r)) if (!RULE_KEYS.includes(key)) unknown(`${at}.${key}`, key, RULE_KEYS, 'a rule');
      let ok = true;
      const no = (path: string, message: string) => {
        ok = false;
        bad(path, message);
      };
      if (typeof r.id !== 'string' || !STANDARD_RULE_ID.test(r.id)) no(`${at}.id`, '"id" must be lowercase letters, digits and single hyphens, starting with a letter, up to 41 characters.');
      else if (seen.has(r.id)) no(`${at}.id`, `"${r.id}" is used by two rules.`);
      else seen.add(r.id);
      for (const [key, max] of [['name', STANDARD_LIMITS.ruleName], ['text', STANDARD_LIMITS.ruleText]] as const) {
        const why = textProblem(r[key], 1, max);
        if (why) no(`${at}.${key}`, `"${key}" ${why}`);
      }
      if (r.missing !== undefined) {
        const why = textProblem(r.missing, 1, STANDARD_LIMITS.ruleName);
        if (why) no(`${at}.missing`, `"missing" ${why}`);
      }
      let when: StandardRule['when'];
      if (r.when !== undefined) {
        // Absent means every item; an empty object is a mistake, never a quiet "everything".
        when = readWhen(r.when, `${at}.when`, bad, textProblem);
        if (when === undefined) ok = false;
      }
      let failAs: FailAs = 'thin';
      if (r.fail !== undefined) {
        if (r.fail === 'thin' || r.fail === 'fail') failAs = r.fail;
        else no(`${at}.fail`, '"fail" must be "thin" (the item needs work) or "fail" (the item is not ready).');
      }
      const check = readCheck(r.check, `${at}.check`, no, unknown);
      if (ok && check) rules.push({ id: r.id as string, name: (r.name as string).trim(), ...(typeof r.missing === 'string' ? { missing: r.missing.trim() } : {}), text: (r.text as string).trim(), ...(when ? { when } : {}), fail: failAs, check });
    });
  }

  if (problems.length > 0) return fail();
  return { standard: { name: name as string, revision, ...(description !== undefined ? { description } : {}), rules }, warnings };
}

function readCheck(
  raw: unknown,
  at: string,
  no: (path: string, message: string) => void,
  unknown: (at: string, key: string, takes: readonly string[], what: string) => void,
): RuleCheck | undefined {
  if (!isRecord(raw)) {
    no(at, `"check" must be an object with a "kind": ${CHECK_KINDS.join(', ')}.`);
    return undefined;
  }
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(CHECK_KINDS as readonly string[]).includes(kind)) {
    no(`${at}.kind`, `"kind" must be one of ${CHECK_KINDS.join(', ')}.`);
    return undefined;
  }
  const k = kind as CheckKind;
  for (const key of Object.keys(raw)) if (!CHECK_KEYS[k].includes(key)) unknown(`${at}.${key}`, key, CHECK_KEYS[k], `a ${k} check`);
  let ok = true;
  const bad = (path: string, message: string) => {
    ok = false;
    no(path, message);
  };

  // `judge` reads the description unless told otherwise; every other kind says where it looks.
  const places: Place[] = [];
  if (raw.in === undefined && k === 'judge') places.push('description');
  else if (!Array.isArray(raw.in) || raw.in.length === 0 || raw.in.length > STANDARD_LIMITS.places) {
    bad(`${at}.in`, `"in" must be a list of 1 to ${STANDARD_LIMITS.places} places: title, description, criteria, or field:<alias or id>.`);
  } else {
    raw.in.forEach((p: unknown, i: number) => {
      const path = `${at}.in[${i}]`;
      if (typeof p !== 'string') return bad(path, 'A place must be text: title, description, criteria, or field:<alias or id>.');
      const place = p.trim();
      if (PLAIN_PLACES.includes(place)) {
        if (places.includes(place as Place)) return bad(path, `"${place}" is listed twice.`);
        return void places.push(place as Place);
      }
      if (place.startsWith('field:')) {
        const field = place.slice('field:'.length).trim();
        if (!FIELD_NAME.test(field)) return bad(path, `"${p}" must name a field: field: then an alias or id of up to 100 letters, digits, spaces, ".", "_", ":", "/" or "-".`);
        if (findSecrets(field).length > 0) return bad(path, 'A field name holds something shaped like a credential, and a standard never holds one.');
        const norm = `field:${field}` as Place;
        if (places.includes(norm)) return bad(path, `"${norm}" is listed twice.`);
        return void places.push(norm);
      }
      bad(path, `"${p}" isn't a place a rule can look: title, description, criteria, or field:<alias or id>.`);
    });
  }

  switch (k) {
    case 'pattern': {
      let flags = '';
      if (raw.flags !== undefined) {
        if (typeof raw.flags !== 'string' || !/^[ims]{0,3}$/.test(raw.flags) || new Set(raw.flags).size !== raw.flags.length) bad(`${at}.flags`, '"flags" may hold only i (any case), m (^ and $ at each line) and s (. matches a line break), each once.');
        else flags = raw.flags;
      }
      const match: string[] = [];
      if (!Array.isArray(raw.match) || raw.match.length === 0 || raw.match.length > STANDARD_LIMITS.patterns) {
        bad(`${at}.match`, `"match" must be a list of 1 to ${STANDARD_LIMITS.patterns} regular expressions, every one of which must be found.`);
      } else {
        raw.match.forEach((m: unknown, i: number) => {
          const path = `${at}.match[${i}]`;
          if (typeof m !== 'string' || m.length === 0) return bad(path, 'A pattern must be a regular expression, as text.');
          if (m.length > STANDARD_LIMITS.patternLength) return bad(path, `A pattern is ${m.length} characters; the most is ${STANDARD_LIMITS.patternLength}.`);
          if (isControl(m)) return bad(path, 'A pattern must be one line, with no line breaks or control characters; write \\n for a line break.');
          if (findSecrets(m).length > 0) return bad(path, 'A pattern holds something shaped like a credential, and a standard never holds one.');
          const unsafe = patternProblem(m);
          if (unsafe) return bad(path, `The pattern ${unsafe}`);
          try {
            new RegExp(m, flags);
          } catch (err) {
            return bad(path, `The pattern doesn't compile: ${(err as Error).message}.`);
          }
          match.push(m);
        });
      }
      // Plain names for the patterns, one each, so a reason can say "Missing a Then line" to someone who doesn't read regex.
      let labels: string[] | undefined;
      if (raw.labels !== undefined) {
        if (!Array.isArray(raw.labels) || !Array.isArray(raw.match) || raw.labels.length !== raw.match.length) {
          bad(`${at}.labels`, `"labels" must be a list with one plain name per pattern in "match", in the same order, e.g. "a Given line".`);
        } else {
          labels = [];
          raw.labels.forEach((l: unknown, i: number) => {
            const why = textProblem(l, 1, STANDARD_LIMITS.labelLength);
            if (why) bad(`${at}.labels[${i}]`, `A label ${why}`);
            else labels!.push((l as string).trim());
          });
        }
      }
      return ok ? { kind: 'pattern', in: places, match, flags, ...(labels ? { labels } : {}) } : undefined;
    }
    case 'section': {
      const heading: string[] = [];
      if (!Array.isArray(raw.heading) || raw.heading.length === 0 || raw.heading.length > STANDARD_LIMITS.headings) {
        bad(`${at}.heading`, `"heading" must be a list of 1 to ${STANDARD_LIMITS.headings} headings, any one of which may start the section.`);
      } else {
        raw.heading.forEach((h: unknown, i: number) => {
          const why = textProblem(h, 1, STANDARD_LIMITS.headingLength);
          if (why) bad(`${at}.heading[${i}]`, `A heading ${why}`);
          else heading.push((h as string).trim());
        });
      }
      let minWords = 1;
      if (raw.minWords !== undefined) {
        if (typeof raw.minWords === 'number' && Number.isInteger(raw.minWords) && raw.minWords >= 1 && raw.minWords <= STANDARD_LIMITS.minWords) minWords = raw.minWords;
        else bad(`${at}.minWords`, `"minWords" must be a whole number from 1 to ${STANDARD_LIMITS.minWords}.`);
      }
      return ok ? { kind: 'section', in: places, heading, minWords } : undefined;
    }
    case 'words': {
      const min = raw.min;
      if (typeof min !== 'number' || !Number.isInteger(min) || min < 1 || min > STANDARD_LIMITS.words) {
        bad(`${at}.min`, `"min" must be a whole number of words from 1 to ${STANDARD_LIMITS.words}.`);
        return undefined;
      }
      return ok ? { kind: 'words', in: places, min } : undefined;
    }
    case 'field':
      return ok ? { kind: 'field', in: places } : undefined;
    case 'judge':
      return ok ? { kind: 'judge', in: places } : undefined;
  }
}

/** The file's text: a stable key order, two-space JSON, a trailing line feed. */
export function standardContent(standard: Standard): string {
  return `${JSON.stringify(standard, null, 2)}\n`;
}
