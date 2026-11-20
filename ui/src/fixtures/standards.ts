/**
 * The sample's ticket rules (#657), for the site preview, `toil-ui --sample`
 * and the layout check: the built-in starter rules each sample toil project
 * names in `standards.use`, and a scripted stand-in for the person's AI agent
 * that judges them. The script reads each rule's starter for the shape it asks
 * (Given/When/Then lines, "As a …, I want …, so that …", a repro section) and
 * answers as an agent would, quote and all, and its answers go through the same
 * reader a real answer does (src/rules.ts, `readJudgement`), quote check
 * included. The sample opens with most of card-payments judged, one verdict
 * held to unsure because its quote isn't in the item, and the last open item
 * not judged yet, so every state shows; pressing Check with AI agent judges the
 * rest. A rule file the sample can't read (anything not built in) is a warning,
 * never a guess. A rehearsal, with a script, in front of nobody.
 */

import { builtinStandard } from '../../../src/core/standards/builtin.ts';
import { loadToilProject } from '../load.ts';
import { readReadiness } from '../model/readiness.ts';
import { itemEvidence, itemRevision, itemText, type ItemEvidence, MAX_JUDGE_ITEMS, readingOf, readJudgement, ruleIn, ruleRevision, type JudgeRule, type RulesBackend, type RuleVerdict, type RulesView, type StandardSummary } from '../rules.ts';
import type { Execute, WorkItem } from '../toil.ts';
import { FIXTURE_NOW, fixtureExecute } from './execute.ts';
import { TOIL_PROJECTS } from './toil-projects.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Who judged the sample's verdicts: plainly a script, never passed off as a real agent's reading. */
export const SAMPLE_JUDGE = "The sample's scripted agent";
/** When the seeded verdicts were judged: an hour before the sample's day. */
const SEEDED_AT = new Date(Date.parse(FIXTURE_NOW) - 3_600_000).toISOString();

/** The first line of `text` matching `re`, as a quote; null when none does. */
const lineMatching = (text: string, re: RegExp): string | null => text.split('\n').map((l) => l.trim()).find((l) => re.test(l)) ?? null;
/** The first line matching `re` and the line after it, as a quote: a bare heading is too short to show anything. */
const sectionMatching = (text: string, re: RegExp): string | null => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const at = lines.findIndex((l) => re.test(l));
  return at < 0 ? null : lines.slice(at, at + 2).join('\n');
};

/**
 * What the script answers for one rule on one item, as an agent would: the shape the built-in starter asks for, read
 * off the item's text. A rule it doesn't know is unsure, saying why.
 */
export function scriptedVerdict(item: WorkItem, text: string, r: JudgeRule): { verdict: string; reason: string; quote: string | null } {
  const story = item.type === 'STORY';
  const bug = item.type === 'BUG';
  // A "doesn't apply" names the item's type as its evidence, as the prompt asks a real agent to.
  const kind = item.typeName ?? item.type;
  if (r.standard === 'gherkin') {
    if (!story) return { verdict: 'na', reason: 'This rule is for stories, and this item is not one.', quote: kind };
    const given = lineMatching(text, /^\W*given\b/i);
    const has = given && lineMatching(text, /^\W*when\b/i) && lineMatching(text, /^\W*then\b/i);
    return has ? { verdict: 'met', reason: 'The acceptance criteria are written as Given, When and Then lines.', quote: given } : { verdict: 'missed', reason: 'No acceptance criteria written as Given/When/Then scenarios.', quote: null };
  }
  if (r.standard === 'user-story') {
    if (!story) return { verdict: 'na', reason: 'This rule is for stories, and this item is not one.', quote: kind };
    const line = lineMatching(text, /\bas an? [^,]+,? i want\b.*\bso that\b/i);
    return line ? { verdict: 'met', reason: 'The description opens with who, what and why.', quote: line } : { verdict: 'missed', reason: 'The description is not written as "As a …, I want …, so that …".', quote: null };
  }
  if (r.standard === 'bug-repro') {
    if (!bug) return { verdict: 'na', reason: 'This rule is for bugs, and this item is not one.', quote: kind };
    const heading = { steps: /^#*\s*(steps to reproduce|repro steps|steps)\b/i, expected: /^#*\s*expected\b/i, actual: /^#*\s*actual\b/i }[r.rule as 'steps' | 'expected' | 'actual'];
    const line = heading ? sectionMatching(text, heading) : null;
    return line ? { verdict: 'met', reason: `The bug has a section for it.`, quote: line } : { verdict: 'missed', reason: r.rule === 'steps' ? 'The bug does not say how to reproduce it.' : r.rule === 'expected' ? 'The bug does not say what should happen.' : 'The bug does not say what happens instead.', quote: null };
  }
  return { verdict: 'unsure', reason: "The sample's scripted agent only knows the built-in starter rules.", quote: null };
}

interface Loaded {
  standards: StandardSummary[];
  warnings: string[];
  items: WorkItem[];
  texts: Map<string, { text: string; rev: string; evidence: ItemEvidence }>;
}

/** A kept verdict: the page's, with what it was judged on. */
type Kept = RuleVerdict & { item: string; itemRev: string; ruleRev: string };

/** The sample's rules and its scripted judge, worked out once per toil project from the items its dashboard loads. */
export function fixtureStandards(execute: Execute = fixtureExecute().execute, o: { delay?: number; now?: () => string } = {}): RulesBackend {
  const loads = new Map<string, Promise<Loaded>>();
  const kept = new Map<string, Map<string, Kept>>();
  const now = o.now ?? (() => FIXTURE_NOW);

  const judgeWith = (tp: string, l: Loaded, items: readonly WorkItem[], at: string, tamper?: (id: string) => boolean): number => {
    const rules: JudgeRule[] = l.standards.flatMap((s) => s.rules.map((r) => ({ standard: s.name, rule: r.id, name: r.name })));
    const batch = items.map((i) => ({ id: i.id, evidence: l.texts.get(i.id)!.evidence }));
    const answer = items.flatMap((i) =>
      rules.map((r) => {
        const said = scriptedVerdict(i, l.texts.get(i.id)!.text, r);
        // The seeded quote no item says, so the sample shows the server holding an unverified verdict to unsure.
        return { item: i.id, standard: r.standard, rule: r.rule, ...said, ...(tamper?.(i.id) && said.verdict !== 'na' ? { verdict: 'met', quote: 'Given a returning customer with two saved cards' } : {}) };
      }),
    );
    const { verdicts } = readJudgement(answer, batch, rules, SAMPLE_JUDGE, at);
    const texts = new Map(l.standards.flatMap((s) => s.rules.map((r) => [`${s.name}/${r.id}`, ruleRevision(r)])));
    const m = kept.get(tp) ?? new Map<string, Kept>();
    for (const v of verdicts) m.set(`${v.item}\n${v.standard}/${v.rule}`, { ...v, itemRev: l.texts.get(v.item)!.rev, ruleRev: texts.get(`${v.standard}/${v.rule}`)! });
    kept.set(tp, m);
    return new Set(verdicts.map((v) => v.item)).size;
  };

  const load = (tp: string): Promise<Loaded> => {
    let p = loads.get(tp);
    if (!p) {
      p = (async () => {
        const file = TOIL_PROJECTS.find((d) => d.name === tp) as Rec | undefined;
        if (!file) throw new Error(`The sample has no Toil project ${tp}.`);
        const use = isRec(file.standards) && Array.isArray(file.standards.use) ? (file.standards.use as string[]) : [];
        const warnings: string[] = [];
        const standards: StandardSummary[] = use.flatMap((name) => {
          const found = builtinStandard(name);
          if (found) return [{ name: found.name, revision: found.revision, source: 'built-in' as const, description: found.description ?? null, rules: found.rules }];
          warnings.push(`The sample reads only the built-in ticket rules, so ${name} wasn't read.`);
          return [];
        });
        const items: WorkItem[] = (await loadToilProject(execute, tp)).items;
        const settings = readReadiness(file);
        const texts = new Map(
          items.map((i) => {
            const field = settings.areas[i.source.area]?.acceptanceField ?? null;
            const text = itemText(i, field);
            return [i.id, { text, rev: itemRevision(text), evidence: itemEvidence(i, field) }];
          }),
        );
        const l: Loaded = { standards, warnings, items, texts };
        // Seeded: every open item judged but the last, and the second open story's "met" held to unsure for a quote it can't show.
        const open = items.filter((i) => i.statusCategory !== 'DONE');
        const seeded = open.slice(0, Math.max(0, open.length - 1));
        const tampered = seeded.filter((i) => i.type === 'STORY')[1]?.id;
        if (standards.length) judgeWith(tp, l, seeded, SEEDED_AT, (id) => id === tampered);
        return l;
      })();
      loads.set(tp, p);
    }
    return p;
  };

  const read = async (tp: string): Promise<RulesView> => {
    const l = await load(tp);
    const verdicts: Record<string, RuleVerdict[]> = {};
    for (const v of kept.get(tp)?.values() ?? []) {
      if (l.texts.get(v.item)?.rev !== v.itemRev) continue;
      const { item, standard, rule, name, verdict: said, reason, quote, note, by, at } = v;
      const verdict: RuleVerdict = { standard, rule, name, verdict: said, reason, quote, note, by, at };
      (verdicts[item] ??= []).push(verdict);
    }
    return { toilProject: tp, standards: l.standards, verdicts, synced: true, warnings: l.warnings, agent: { label: SAMPLE_JUDGE, problem: null }, judging: null };
  };

  return {
    read,
    async judge(tp, request) {
      const l = await load(tp);
      const byId = new Map(l.items.map((i) => [i.id, i]));
      const wanted = [...new Set(request.items)].map((id) => byId.get(id)).filter((i): i is WorkItem => Boolean(i));
      const held = (await read(tp)).verdicts;
      const count = l.standards.reduce((n, s) => n + s.rules.length, 0);
      const todo = wanted.filter((i) => (held[i.id]?.length ?? 0) < count);
      const take = todo.slice(0, MAX_JUDGE_ITEMS);
      if (o.delay) await new Promise((r) => setTimeout(r, o.delay));
      const judged = take.length && l.standards.length ? judgeWith(tp, l, take, now()) : 0;
      return { view: await read(tp), judged, current: wanted.length - todo.length, left: todo.length - take.length, by: SAMPLE_JUDGE, notes: [] };
    },
    async ruleFor(tp, item, standard, rule) {
      return ruleIn(readingOf(await read(tp)), item, standard, rule);
    },
  };
}
