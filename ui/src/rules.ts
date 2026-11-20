/**
 * Ticket rules on screen (#657): the seam the page reads a toil project's rules
 * and the AI agent's verdicts through, and the pure helpers its views and the
 * server share. A rule is plain-text instructions a person wrote (toil's
 * `standards list` reads them); whether an item meets one, and whether it
 * applies at all, is the person's own AI agent's reading, asked for on a press
 * (ui/server/standards.ts, or the sample's script in src/fixtures/standards.ts).
 * Every verdict says which agent gave it and when, and carries a quote from the
 * item that the server found in the item's text, or it is held to "unsure".
 * Nothing here writes: fixing an item is an assignment, whose proposal a
 * person applies through toil's write gate. Toil calls them standards in its
 * files; on screen they are ticket rules, because nobody has ever been
 * reassured by being told a ticket is non-standard.
 */

import type { StandardRule, StandardSummary } from '../../src/core/standards/types.ts';
import { ADO_ACCEPTANCE_FIELD, textOf } from '../../src/core/standards/text.ts';
import { countsAs, fieldValue, RULES_UNREAD, type RulesReading } from './model/readiness.ts';
import type { WorkItem } from './toil.ts';

export type { StandardRule, StandardSummary };

/** What the agent said of one rule on one item: met, missed, unsure, or the rule doesn't apply to it. */
export type Judgement = 'met' | 'missed' | 'unsure' | 'na';
export const JUDGEMENTS: readonly Judgement[] = ['met', 'missed', 'unsure', 'na'];
export const JUDGEMENT_WORD: Record<Judgement, string> = { met: 'Met', missed: 'Missed', unsure: 'Unsure', na: "Doesn't apply" };

/** One rule's verdict on one item: the AI agent's reading, never a deterministic result (principle 4). */
export interface RuleVerdict {
  standard: string;
  rule: string;
  /** The rule's name when it was judged. */
  name: string;
  verdict: Judgement;
  /** The agent's one-line reason. */
  reason: string;
  /** A short quote from the item supporting the verdict, which the server found in the item's text; null when the agent gave none. */
  quote: string | null;
  /** What Toil UI changed and why: a quote it couldn't find in the item turns the verdict into unsure, and this says so. Null otherwise. */
  note: string | null;
  /** Which AI agent judged it, as its label reads ("Claude (sonnet)"). */
  by: string;
  /** When. */
  at: string;
}

/** A judging press running now for a toil project. */
export interface JudgingNow {
  items: number;
  by: string;
  startedAt: string;
}

/** The agent a press would ask: its label, and why it can't run now (null when it can). */
export interface JudgeAgent {
  label: string;
  problem: string | null;
}

/**
 * What `api/standards` answers for a toil project: the rules it names (as
 * `toil standards list --toil-project` read them), and each item's verdicts
 * that still hold, judged on the item's current text and the rule's current
 * text. A verdict that no longer holds is left out, so the item reads as not
 * judged yet (principle 12).
 */
export interface RulesView {
  toilProject: string;
  standards: StandardSummary[];
  /** Verdicts by OWI id; an item or rule with none is not judged yet. */
  verdicts: Record<string, RuleVerdict[]>;
  /** Whether the toil project has synced: with no items there is nothing to judge, and that is not a zero. */
  synced: boolean;
  /** What toil said reading the rules, in its words. */
  warnings: string[];
  /** The agent a press asks, or null when none is set up. */
  agent: JudgeAgent | null;
  judging: JudgingNow | null;
}

/** What one press asked for: OWI ids, judged on every rule the toil project names. */
export interface JudgeRequest {
  items: string[];
}

/** What a press came back with: the view after it, and what it did. */
export interface JudgeResult {
  view: RulesView;
  /** Items the agent judged this time. */
  judged: number;
  /** Items left alone because every rule's verdict still held. */
  current: number;
  /** Items not judged this time: past the most one press takes, or the time limit. */
  left: number;
  by: string | null;
  /** What is worth saying: a verdict the agent didn't give, an answer it couldn't read. */
  notes: string[];
}

/** The page's side: the server's routes, or the sample's. Throws with a message the page shows. */
export interface RulesApi {
  read(toilProject: string): Promise<RulesView>;
  judge(toilProject: string, request: JudgeRequest): Promise<JudgeResult>;
}

/** One rule on one item, with the rule's own text and its verdict now: what an assignment to fix it is told. */
export interface RuleFound {
  standard: string;
  rule: string;
  name: string;
  text: string;
  verdict: RuleVerdict | null;
}

/** The server's side: the page's routes, and one rule on one item, as the assignment queue checks it before it queues a fix. */
export interface RulesBackend extends RulesApi {
  ruleFor(toilProject: string, item: string, standard: string, rule: string): Promise<RuleFound | null>;
}

/** A standard's or a rule's name: what the route and an assignment accept. */
export const RULE_REF = /^[a-z][a-z0-9-]{0,62}$/;

/** The most items one press judges; the rest are said to be left, for another press. */
export const MAX_JUDGE_ITEMS = 60;
/** How many items one agent call reads: few enough that every rule on every item gets a careful look. */
export const JUDGE_BATCH = 8;
/** The most of one item's text the agent reads. */
export const MAX_ITEM_TEXT = 8000;
/** The longest reason and quote kept from an answer. */
export const MAX_REASON = 300;
export const MAX_QUOTE = 300;

// The item's text ------------------------------------------------------------------

const REPRO_FIELD = 'Microsoft.VSTS.TCM.ReproSteps';

/** An item's own words, each kept apart from the labels Toil UI puts around them. */
interface ItemParts {
  title: string;
  type: string;
  labels: string[];
  /** The description, or null when it was never read. */
  body: string | null;
  fields: Array<{ label: string; key: string; text: string }>;
}

function itemParts(item: WorkItem, acceptanceField: string | null): ItemParts {
  const body = item.body ? textOf(item.body.content, item.body.format).trim() : null;
  const criteria = acceptanceField ?? (item.source.area.startsWith('ado') ? ADO_ACCEPTANCE_FIELD : null);
  const seen = new Set<string>();
  const fields: ItemParts['fields'] = [];
  for (const [label, field] of [['Acceptance criteria', criteria], ['Repro steps', item.source.area.startsWith('ado') ? REPRO_FIELD : null]] as const) {
    if (!field) continue;
    const found = fieldValue(item, field);
    if (!found || seen.has(found.key)) continue;
    seen.add(found.key);
    const text = textOf(found.value).trim();
    if (text) fields.push({ label, key: found.key, text });
  }
  return { title: item.title, type: item.typeName ?? item.type, labels: item.labels, body, fields };
}

/**
 * The item's text as the agent reads it: its title, type and labels, its
 * description, and the fields a ticket rule most often speaks of (the
 * acceptance criteria field the toil project names, else Azure DevOps' own;
 * Azure DevOps' repro steps). A record with no `body` never had its
 * description read, and says so rather than claiming an empty one (principle
 * 12). Quotes are never checked against this, since its labels are Toil UI's
 * words, not the item's: see `itemEvidence`.
 */
export function itemText(item: WorkItem, acceptanceField: string | null): string {
  const p = itemParts(item, acceptanceField);
  const out = [`Title: ${p.title}`, `Type: ${p.type}`];
  if (p.labels.length) out.push(`Labels: ${p.labels.join(', ')}`);
  out.push('Description:', p.body === null ? '(not read)' : p.body || '(empty)');
  for (const f of p.fields) out.push(`${f.label} (field ${f.key}):`, f.text);
  const text = out.join('\n');
  return text.length > MAX_ITEM_TEXT ? `${text.slice(0, MAX_ITEM_TEXT)}\n[cut at ${MAX_ITEM_TEXT} characters]` : text;
}

/**
 * What a quote is checked against: the item's own words (its title, labels,
 * description and field values, each apart, so a quote can't run from one into
 * the next), and its type and labels as names a "doesn't apply" may give as
 * its evidence. Never the labels Toil UI writes around them ("Title:",
 * "Description:", "(empty)").
 */
export interface ItemEvidence {
  parts: string[];
  tags: string[];
}

export function itemEvidence(item: WorkItem, acceptanceField: string | null): ItemEvidence {
  const p = itemParts(item, acceptanceField);
  const parts = [p.title, ...p.labels, p.body ?? '', ...p.fields.map((f) => f.text)].filter((t) => t.trim());
  return { parts, tags: [...new Set([p.type, item.type, ...p.labels])] };
}

/** Text as a quote is compared: one kind of quote mark, no case, single spaces, no list marks at line starts. */
export function normaliseQuote(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|\[[ xX]?\])\s+/gm, '')
    .replace(/[‘’“”"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The least a quote must hold, once normalised, to show anything: three words or fifteen characters. A word or two is found in almost any item. */
export const MIN_QUOTE_WORDS = 3;
export const MIN_QUOTE_CHARS = 15;

/** Whether a quote is long enough to support a verdict. */
export function quoteLongEnough(quote: string): boolean {
  const q = normaliseQuote(quote);
  return q.length >= MIN_QUOTE_CHARS || q.split(' ').filter(Boolean).length >= MIN_QUOTE_WORDS;
}

/** Whether a quote appears in one of the item's own words, whitespace, case and quote marks aside. An empty or too-short quote never does. */
export function quoteIn(quote: string, evidence: Pick<ItemEvidence, 'parts'>): boolean {
  const q = normaliseQuote(quote);
  return q.length > 0 && quoteLongEnough(quote) && evidence.parts.some((p) => normaliseQuote(p).includes(q));
}

/** Whether a quote is exactly the item's type or one of its labels: the evidence a "doesn't apply" may give. */
export const quoteNamesTag = (quote: string, evidence: Pick<ItemEvidence, 'tags'>): boolean => {
  const q = normaliseQuote(quote);
  return q.length > 0 && evidence.tags.some((t) => normaliseQuote(t) === q);
};

/** A short, stable hash of a text (two FNV-1a rounds), for keying a verdict on a rule's text or an item's. Not a secret, just a fingerprint. */
export function textHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * What a verdict is keyed on, besides the item and the rule: the hash of the item's text as the agent read it. Never the
 * item's `updated`, which stays put when Toil UI reads a description or an acceptance field it hadn't read before.
 */
export const itemRevision = (text: string): string => `text:${textHash(text)}`;
/** What a verdict is keyed on for the rule: its text. A renamed rule keeps its verdicts; a reworded one is judged again. */
export const ruleRevision = (r: Pick<StandardRule, 'text'>): string => textHash(r.text);

// Reading an answer ---------------------------------------------------------------------

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const oneLine = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** One rule of the batch, as an answer may name it. */
export interface JudgeRule {
  standard: string;
  rule: string;
  name: string;
}

/**
 * The agent's answer for one batch, read and checked: each entry must name an
 * item of the batch and a rule of the toil project, with one of the four
 * verdicts; the first entry for a pair wins. Every quote is looked for in that
 * item's own words, in full (`itemEvidence`), and must be long enough to show
 * something: one that isn't there makes the verdict unsure, with a note saying
 * so, as an unseen `[[id]]` citation is flagged, and one too short is left out.
 * A "doesn't apply" may instead name the item's type or a label. A "met" with
 * no quote is unsure too, since nothing on the item was shown to meet the rule;
 * a "doesn't apply" with none is kept, and readiness counts it as unknown
 * (model/readiness.ts). Pairs the answer left out stay unjudged, and the notes
 * count them.
 */
export function readJudgement(answer: unknown, batch: ReadonlyArray<{ id: string; evidence: ItemEvidence }>, rules: readonly JudgeRule[], by: string, at: string): { verdicts: Array<RuleVerdict & { item: string }>; notes: string[] } {
  const notes: string[] = [];
  if (!Array.isArray(answer)) return { verdicts: [], notes: ['The AI agent did not answer with a list of readings, so nothing was judged.'] };
  const texts = new Map(batch.map((b) => [b.id, b.evidence]));
  const named = new Map(rules.map((r) => [`${r.standard}/${r.rule}`, r]));
  const out = new Map<string, RuleVerdict & { item: string }>();
  let refused = 0;
  for (const raw of answer) {
    if (!isRec(raw)) {
      refused++;
      continue;
    }
    const item = typeof raw.item === 'string' ? raw.item : '';
    const key = `${typeof raw.standard === 'string' ? raw.standard : ''}/${typeof raw.rule === 'string' ? raw.rule : ''}`;
    const rule = named.get(key);
    const verdict = typeof raw.verdict === 'string' ? (raw.verdict.toLowerCase().replace(/[^a-z]/g, '') as string) : '';
    const said: Judgement | null = verdict === 'met' ? 'met' : verdict === 'missed' ? 'missed' : verdict === 'unsure' ? 'unsure' : verdict === 'na' || verdict === 'doesntapply' || verdict === 'notapplicable' ? 'na' : null;
    const text = texts.get(item);
    if (!rule || text === undefined || !said) {
      refused++;
      continue;
    }
    if (out.has(`${item}\n${key}`)) continue;
    const reason = typeof raw.reason === 'string' && raw.reason.trim() ? oneLine(raw.reason, MAX_REASON) : 'The AI agent gave no reason.';
    // The whole quote is checked as sent, line breaks kept, so normaliseQuote drops a list mark at the start of every line
    // of a bulleted quote, not just the first; only what is kept for the screen is collapsed and cut short.
    const given = typeof raw.quote === 'string' && raw.quote.trim() ? raw.quote.trim() : null;
    let final: Judgement = said;
    let note: string | null = null;
    let quote: string | null = null;
    if (given && said === 'na' && quoteNamesTag(given, text)) {
      quote = oneLine(given, MAX_QUOTE);
    } else if (given && !quoteLongEnough(given)) {
      note = `The AI agent quoted only "${oneLine(given, 80)}", too little to show anything, so Toil UI left the quote out.`;
      if (said === 'met') {
        final = 'unsure';
        note = `The AI agent said met, quoting only "${oneLine(given, 80)}", too little to show anything, so Toil UI keeps it as unsure.`;
      }
    } else if (given && !quoteIn(given, text)) {
      final = 'unsure';
      note = `The AI agent said ${JUDGEMENT_WORD[said].toLowerCase()}, quoting "${oneLine(given, 80)}", but that isn't in the item's text, so Toil UI keeps it as unsure.`;
    } else if (given) {
      quote = oneLine(given, MAX_QUOTE);
    } else if (said === 'met') {
      final = 'unsure';
      note = 'The AI agent said met without quoting the item, so Toil UI keeps it as unsure.';
    }
    out.set(`${item}\n${key}`, { item, standard: rule.standard, rule: rule.rule, name: rule.name, verdict: final, reason, quote, note, by, at });
  }
  if (refused > 0) notes.push(`${refused} of the AI agent's readings named an item or rule it wasn't asked about, or no answer Toil UI knows (met, missed, unsure or doesn't apply), so ${refused === 1 ? 'it was' : 'they were'} left out.`);
  const missing = batch.length * rules.length - out.size;
  if (missing > 0) notes.push(`The AI agent gave no reading for ${missing} rule${missing === 1 ? '' : 's'} on these items; ${missing === 1 ? 'it stays' : 'they stay'} not judged yet.`);
  return { verdicts: [...out.values()], notes };
}

// The page's reading ---------------------------------------------------------------------

/** The page's reading from what the read gave: read (with each item's verdicts), not read yet, or failed with the message. */
export function readingOf(view: RulesView | null, error?: string): RulesReading {
  if (error !== undefined) return { state: 'failed', standards: [], byItem: new Map(), message: error, warnings: [] };
  if (!view) return RULES_UNREAD;
  return { state: 'read', standards: view.standards, byItem: new Map(Object.entries(view.verdicts)), message: null, warnings: view.warnings };
}

/** Every rule the reading names, with its standard, in order. */
export const rulesOf = (reading: Pick<RulesReading, 'standards'>): Array<StandardRule & { standard: string }> => reading.standards.flatMap((s) => s.rules.map((r) => ({ ...r, standard: s.name })));

/** One rule's verdict on one item, or null when it isn't judged yet. */
export const verdictOf = (reading: Pick<RulesReading, 'byItem'>, item: string, standard: string, rule: string): RuleVerdict | null => reading.byItem.get(item)?.find((v) => v.standard === standard && v.rule === rule) ?? null;

/** One rule on one item, with its text and its verdict now; null when the reading doesn't name the rule. */
export function ruleIn(reading: Pick<RulesReading, 'standards' | 'byItem'>, item: string, standard: string, rule: string): RuleFound | null {
  const r = reading.standards.find((s) => s.name === standard)?.rules.find((x) => x.id === rule);
  return r ? { standard, rule, name: r.name, text: r.text, verdict: verdictOf(reading, item, standard, rule) } : null;
}

/** An item none of whose rules is judged yet, or any of them: what a press would ask about. */
export const unjudged = (reading: Pick<RulesReading, 'standards' | 'byItem'>, item: string): number => rulesOf(reading).filter((r) => !verdictOf(reading, item, r.standard, r.id)).length;

/**
 * One standard's line on the Tickets page: of the open items, how many the
 * agent judged to miss any of its rules, how many it was unsure of, how many
 * met them all, how many they don't apply to, and how many aren't judged yet.
 * A standard with several rules (bug-repro's steps, expected and actual) is one
 * line, so a bug that misses all three counts once.
 */
export interface RuleLine {
  standard: string;
  rules: Array<{ rule: string; name: string }>;
  /** `standard/rule` for a one-rule standard, the standard's name otherwise: the address filter's value. */
  ref: string;
  miss: number;
  unsure: number;
  met: number;
  na: number;
  unjudged: number;
}

/** A rule's name inside a sentence: its first letter in lower case, unless the name starts with an acronym ("KTLO"). */
export const inSentence = (name: string) => (/^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name);

/** Names in a sentence: "a", "a and b", "a, b and c" (or "or"). */
export function listed(names: readonly string[], join: 'and' | 'or' = 'and'): string {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${join} ${names.at(-1)}`;
}

/** What a line's items miss, in a sentence: its rule names, joined with "or" (an item that misses any one of them counts). */
export const lineWhat = (l: Pick<RuleLine, 'rules'>): string => listed(l.rules.map((r, i) => (i === 0 ? r.name : inSentence(r.name))), 'or');

/** Each standard's line over these items (the open ones on screen), in the reading's own order. */
export function ruleLines(reading: Pick<RulesReading, 'standards' | 'byItem'>, items: readonly WorkItem[]): RuleLine[] {
  return reading.standards.map((s) => {
    const line: RuleLine = { standard: s.name, rules: s.rules.map((r) => ({ rule: r.id, name: r.name })), ref: s.rules.length === 1 ? `${s.name}/${s.rules[0]!.id}` : s.name, miss: 0, unsure: 0, met: 0, na: 0, unjudged: 0 };
    for (const item of items) {
      // A "doesn't apply" with no evidence counts as unsure here too, as it does for readiness.
      const vs = s.rules.map((r) => verdictOf(reading, item.id, s.name, r.id)).map((v) => (v ? countsAs(v) : null));
      if (vs.some((v) => v === 'missed')) line.miss++;
      else if (vs.some((v) => v === 'unsure')) line.unsure++;
      else if (vs.some((v) => !v)) line.unjudged++;
      else if (vs.every((v) => v === 'na')) line.na++;
      else line.met++;
    }
    return line;
  });
}

/**
 * The item a standard's line leads with, and Fix with AI agent asks to fix: the first open item, in the toil project's
 * order, the agent judged to miss one of the standard's rules and that could start once it meets them; when every one is
 * held up by something else (`blocked`: another item blocks it, say), the first that misses them.
 */
export function firstToFix(reading: Pick<RulesReading, 'standards' | 'byItem'>, standard: string, open: readonly WorkItem[], blocked: (id: string) => boolean): WorkItem | undefined {
  const misses = open.filter((i) => (reading.byItem.get(i.id) ?? []).some((v) => v.standard === standard && v.verdict === 'missed'));
  return misses.find((i) => !blocked(i.id)) ?? misses[0];
}

/** A filter's reference read: `standard/rule` names one rule, a bare standard every rule in it. */
const refOf = (ref: string) => {
  const [standard, rule] = ref.split('/');
  return { standard: standard ?? '', rule: rule ?? null };
};

/** Whether a verdict is one the reference names: the rule, or any rule of the standard. */
export const matchesRef = (ref: string, r: { standard: string; rule: string }) => {
  const want = refOf(ref);
  return r.standard === want.standard && (want.rule === null || r.rule === want.rule);
};

/** The items judged to miss a rule (`standard/rule`), or any rule of a standard (`standard`), by OWI id; null when the reference names nothing the reading knows. */
export function missing(reading: Pick<RulesReading, 'standards' | 'byItem'>, ref: string): Set<string> | null {
  const { standard, rule } = refOf(ref);
  const s = reading.standards.find((x) => x.name === standard);
  if (!s || (rule !== null && !s.rules.some((r) => r.id === rule))) return null;
  const out = new Set<string>();
  for (const [id, vs] of reading.byItem) if (vs.some((v) => matchesRef(ref, v) && v.verdict === 'missed')) out.add(id);
  return out;
}

/** What a filter's reference names, for its chip: a rule's name, or a standard's rule names; null when the reading doesn't know it. */
export function ruleName(reading: Pick<RulesReading, 'standards'>, ref: string): string | null {
  const { standard, rule } = refOf(ref);
  const s = reading.standards.find((x) => x.name === standard);
  if (!s) return null;
  if (rule === null) return s.rules.length ? listed(s.rules.map((r, i) => (i === 0 ? r.name : inSentence(r.name))), 'or') : null;
  return s.rules.find((r) => r.id === rule)?.name ?? null;
}

/**
 * A verdict's short tag for the item page, when Toil UI changed or discounted what the agent said: the full note stays
 * one press in. Null when there is nothing to say.
 */
export function noteTag(v: Pick<RuleVerdict, 'verdict' | 'quote' | 'note'>): string | null {
  if (v.verdict === 'na' && !v.quote) return 'Counts as unknown: no evidence';
  if (!v.note) return null;
  if (v.note.includes('too little')) return v.verdict === 'unsure' ? 'Kept as unsure: quote too short' : 'Quote too short';
  if (v.note.includes('without quoting')) return 'Kept as unsure: no quote';
  return 'Kept as unsure: quote not found';
}

/** When and by whom, as a verdict's source reads: "Claude (sonnet)'s reading, 19 Nov 14:02 UTC". */
export const readingBy = (v: Pick<RuleVerdict, 'by' | 'at'>, when: (iso: string) => string): string => `${v.by}'s reading, ${when(v.at)}`;

/** What the page holds for the toil project on screen: the reading the readiness rows use, the view, and the press. */
export interface RulesState {
  reading: RulesReading;
  view: RulesView | null;
  /** Asks the agent to judge these items; absent where nothing can (a view rendered on its own). */
  judge?: (items: string[]) => Promise<JudgeResult>;
  /** The press running now from this page, with how many items it asked about. */
  judging?: { items: string[] } | null;
}
