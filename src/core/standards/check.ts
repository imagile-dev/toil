/**
 * Checking work items against standards: items and rules in, one result per
 * rule that applies to each item out. Pure data in and data out, no files, no
 * network and no config, so `toil standards check` is exactly as safe as its
 * inputs, Toil UI can run it in the page on items it already holds, and a test
 * can run it with the wifi off. Every result says where its text was read from,
 * and a place the record doesn't carry is `skipped`, "not read", never taken
 * for an empty one (principle 12): a field the read never asked for says
 * nothing about the ticket. The rules are the team's; toil only reads them out
 * loud, which is more than most templates get.
 */
import type { Warning } from '../envelope.js';
import { matchWhen } from '../classify/when.js';
import type { WorkItem } from '../owi/types.js';
import { CRITERIA_HEADINGS, realText, sectionUnder, textOf, wordCount } from './text.js';
import type { FoundStandard, ItemStandards, ItemVerdict, Place, RuleCheck, RuleResult, RuleState, RuleTally, StandardRule, StandardsCheckResult, StandardSummary } from './types.js';

/** Azure DevOps' own acceptance criteria field, on every process that has one. */
export const ADO_ACCEPTANCE_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';

export interface CheckInput {
  standards: FoundStandard[];
  items: WorkItem[];
  toilProject?: string | null;
  /**
   * The toil project's field aliases, by area then alias: `{ jira: { acceptanceCriteria: 'customfield_10300' } }`.
   * A `field:<alias>` place reads the field the alias names, and `criteria` reads `acceptanceCriteria` first.
   */
  fields?: Record<string, Record<string, string>>;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One place's text, or null when the record read doesn't carry it, with where it was read from. */
interface Read {
  text: string | null;
  source: string;
}

/**
 * A field in the item's source records: `fields[<id>]`, as Jira and Azure DevOps
 * both send it, else a key at the top (GitHub's `body`). A key that is there with
 * no value is read and empty; a key that isn't there was never read.
 */
function nativeField(item: WorkItem, id: string): { read: true; value: unknown; key: string } | { read: false } {
  const wanted = id.toLowerCase();
  for (const rec of Object.values(isRec(item.native) ? item.native : {})) {
    if (!isRec(rec)) continue;
    const fields = isRec(rec.fields) ? rec.fields : rec;
    for (const [k, v] of Object.entries(fields)) if (k.toLowerCase() === wanted) return { read: true, value: v, key: k };
  }
  return { read: false };
}

const hasWords = (text: string) => wordCount(realText(text)) > 0;

function readers(item: WorkItem, fields: Record<string, string>) {
  /** A record without a `body` key never had its description read; `body: null` is a description read and found empty. */
  const description = (): Read => {
    const body = (item as { body?: WorkItem['body'] }).body;
    if (body === undefined) return { text: null, source: 'description' };
    return { text: body ? textOf(body.content, body.format) : '', source: 'description' };
  };
  const field = (name: string): Read => {
    const id = fields[name] ?? name;
    const found = nativeField(item, id);
    const label = id === name ? `field ${id}` : `field ${id} (${name})`;
    return found.read ? { text: textOf(found.value), source: `field ${found.key}${id === name ? '' : ` (${name})`}` } : { text: null, source: label };
  };
  /** The acceptance criteria: the first of these that holds any words, else what was read of them, empty. */
  const criteria = (): Read => {
    const tried: Read[] = [];
    const named = fields.acceptanceCriteria;
    const candidates: Array<() => Read> = [];
    if (named) candidates.push(() => field('acceptanceCriteria'));
    if (item.source.area.startsWith('ado') && named !== ADO_ACCEPTANCE_FIELD) candidates.push(() => field(ADO_ACCEPTANCE_FIELD));
    for (const next of candidates) {
      const r = next();
      if (r.text !== null && hasWords(r.text)) return r;
      tried.push(r);
    }
    const desc = description();
    if (desc.text !== null) {
      const section = sectionUnder(desc.text, CRITERIA_HEADINGS);
      if (section && hasWords(section.text)) return { text: section.text, source: `description, under "${section.heading}"` };
      if (hasWords(desc.text)) return desc;
    }
    tried.push(desc);
    const read = tried.filter((r) => r.text !== null);
    if (read.length === 0) return { text: null, source: `criteria (${tried.map((r) => r.source).join(', ')})` };
    return { text: '', source: `criteria (${read.map((r) => r.source).join(', ')})` };
  };
  return (place: Place): Read => {
    if (place === 'title') return { text: item.title, source: 'title' };
    if (place === 'description') return description();
    if (place === 'criteria') return criteria();
    return field(place.slice('field:'.length));
  };
}

const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const either = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Whether the joined text meets the check, and why, in words. */
function judge(check: RuleCheck, text: string, from: string, compiled: RegExp[]): { ok: boolean; reason: string } {
  switch (check.kind) {
    case 'pattern': {
      const missing = check.match.filter((_, i) => !compiled[i]!.test(text));
      if (missing.length === 0) return { ok: true, reason: `${check.match.length === 1 ? 'The pattern was' : `All ${check.match.length} patterns were`} found in ${from}.` };
      const what = check.match.length === 1 ? "The pattern wasn't" : missing.length === check.match.length ? `None of the ${check.match.length} patterns was` : `${missing.length} of the ${check.match.length} patterns weren't`;
      return { ok: false, reason: `${what} found in ${from}; missing: ${missing.map((m) => `/${m}/`).join(', ')}.` };
    }
    case 'section': {
      const found = sectionUnder(text, check.heading);
      if (!found) return { ok: false, reason: `No ${either(check.heading.map((h) => `"${h}"`))} heading in ${from}.` };
      const words = wordCount(realText(found.text));
      if (words < check.minWords) return { ok: false, reason: `The "${found.heading}" heading in ${from} has ${plural(words, 'word')} under it; the rule asks for at least ${check.minWords}.` };
      return { ok: true, reason: `${plural(words, 'word')} under the "${found.heading}" heading in ${from}.` };
    }
    case 'field': {
      const words = wordCount(realText(text));
      if (words > 0) return { ok: true, reason: `${from} holds ${plural(words, 'word')}.` };
      return { ok: false, reason: text.trim() === '' ? `${from} is empty.` : `${from} holds only placeholder text.` };
    }
    case 'words': {
      const words = wordCount(realText(text));
      if (words >= check.min) return { ok: true, reason: `${plural(words, 'word')} in ${from}.` };
      return { ok: false, reason: `${plural(words, 'word')} in ${from}; the rule asks for at least ${check.min}.` };
    }
    case 'judge':
      return { ok: false, reason: '' };
  }
}

const ORDER: Record<Exclude<RuleState, 'skipped'>, number> = { fail: 0, thin: 1, pass: 2 };

/** Checks every item against every rule of every standard, in the order given. */
export function checkStandards(input: CheckInput): { result: StandardsCheckResult; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const fieldsByArea = input.fields ?? {};

  // One result per item: the first of a repeated id stands.
  const items: WorkItem[] = [];
  const byId = new Map<string, WorkItem>();
  const repeated = new Set<string>();
  for (const item of input.items) {
    if (byId.has(item.id)) repeated.add(item.id);
    else {
      byId.set(item.id, item);
      items.push(item);
    }
  }
  if (repeated.size > 0) {
    warnings.push({ code: 'STANDARDS_DUPLICATE_ITEM', message: `${plural(repeated.size, 'item appears', 'items appear')} more than once in the input and ${repeated.size === 1 ? 'was' : 'were'} checked once, the first time: ${[...repeated].slice(0, 3).join(', ')}${repeated.size > 3 ? ', ...' : ''}.` });
  }

  // One standard per name: the first given stands.
  const standards: FoundStandard[] = [];
  const names = new Set<string>();
  for (const s of input.standards) {
    if (names.has(s.standard.name)) {
      warnings.push({ code: 'STANDARDS_DUPLICATE', message: `The standard "${s.standard.name}" was given more than once and is checked once, from the first: ${s.file ?? s.source}.` });
      continue;
    }
    names.add(s.standard.name);
    standards.push(s);
  }

  // Compiled once per rule; the reader already proved each compiles and is safe to run.
  const compiled = new Map<StandardRule, RegExp[]>();
  for (const s of standards) for (const r of s.standard.rules) compiled.set(r, r.check.kind === 'pattern' ? r.check.match.map((m) => new RegExp(m, r.check.kind === 'pattern' ? r.check.flags : '')) : []);

  const tallies = new Map<string, RuleTally & { typeSet: Set<string> }>();
  for (const s of standards) for (const r of s.standard.rules) tallies.set(`${s.standard.name}/${r.id}`, { standard: s.standard.name, rule: r.id, name: r.name, types: [], typeSet: new Set(), applies: 0, pass: 0, thin: 0, fail: 0, skipped: 0 });

  const out: ItemStandards[] = items.map((item) => {
    const read = readers(item, fieldsByArea[item.source.area] ?? {});
    const results: RuleResult[] = [];
    for (const s of standards) {
      for (const rule of s.standard.rules) {
        if (rule.when && matchWhen(rule.when, item, byId) === null) continue;
        const base = { standard: s.standard.name, rule: rule.id, name: rule.name };
        const reads = rule.check.in.map(read);
        const got = reads.filter((r): r is { text: string; source: string } => r.text !== null);
        const unread = reads.filter((r) => r.text === null).map((r) => r.source);
        let result: RuleResult;
        if (rule.check.kind === 'judge') {
          result = { ...base, state: 'skipped', reason: 'Needs an AI agent to judge; toil never passes this rule on its own.', source: reads.map((r) => r.source).join(', ') };
        } else if (got.length === 0) {
          result = { ...base, state: 'skipped', reason: `Not read: ${list(unread)} ${unread.length === 1 ? "isn't" : "aren't"} in the record read, so this wasn't checked.`, source: `not read: ${unread.join(', ')}` };
        } else {
          const from = list(got.map((r) => r.source));
          const verdict = judge(rule.check, got.map((r) => r.text).join('\n'), from, compiled.get(rule)!);
          const note = !verdict.ok && unread.length > 0 ? ` (${list(unread)} not read)` : '';
          result = {
            ...base,
            state: verdict.ok ? 'pass' : rule.fail,
            reason: `${verdict.reason}${note}`,
            source: `${got.map((r) => r.source).join(', ')}${unread.length > 0 ? `; not read: ${unread.join(', ')}` : ''}`,
          };
        }
        results.push(result);
        const t = tallies.get(`${s.standard.name}/${rule.id}`)!;
        t.applies++;
        t[result.state]++;
        t.typeSet.add(item.type);
      }
    }
    const checked = results.filter((r): r is RuleResult & { state: Exclude<RuleState, 'skipped'> } => r.state !== 'skipped');
    const verdict: ItemVerdict = checked.length === 0 ? null : checked.reduce((worst, r) => (ORDER[r.state] < ORDER[worst] ? r.state : worst), 'pass' as Exclude<RuleState, 'skipped'>);
    return { id: item.id, key: item.source.key, area: item.source.area, title: item.title, url: item.url ?? null, verdict, results };
  });

  const summaries: StandardSummary[] = standards.map((s) => ({
    name: s.standard.name,
    revision: s.standard.revision,
    source: s.source,
    ...(s.file ? { file: s.file } : {}),
    rules: s.standard.rules.map((r) => ({ id: r.id, name: r.name, text: r.text, when: r.when ?? null, fail: r.fail, kind: r.check.kind })),
  }));

  return {
    result: {
      toilProject: input.toilProject ?? null,
      standards: summaries,
      items: out,
      summary: {
        items: out.length,
        checked: out.filter((i) => i.verdict !== null).length,
        byRule: [...tallies.values()].map(({ typeSet, ...t }) => ({ ...t, types: [...typeSet].sort() })),
      },
    },
    warnings,
  };
}
