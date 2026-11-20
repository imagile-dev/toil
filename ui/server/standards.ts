/**
 * Ticket rules on the server (#657): the rules a toil project names, read
 * through toil's own `standards list --toil-project` (read-only, in-process),
 * and the person's AI agent judging its items against them, on a press. A rule
 * is plain-text instructions, so nothing here decides whether an item meets
 * one: the agent the person chose under Settings, AI agent, reads each rule and
 * each item, each in its own fence (ui/server/assign/prompts.ts), with no tool
 * at all, and says met, missed, unsure or doesn't apply, with a reason and a
 * quote. Every quote is looked for in the item's text and a verdict whose quote
 * isn't there is kept as unsure (src/rules.ts, `readJudgement`), as an unseen
 * `[[id]]` citation is flagged. Verdicts are kept per item and rule, keyed on
 * the hash of the item's text as the agent read it and the rule's text, so an
 * item is judged again only when one of those changes (a field read later, an
 * edited acceptance field, a reworded rule), and each says which agent judged it and
 * when. Nothing runs on a page load: the page reads, and a person presses.
 *
 * `ruleFor` is what the assignment queue asks before it queues a "Fix with AI
 * agent": the one rule on the one item, with its text and its verdict now. Only
 * a rule judged missed can be fixed, so nobody spends an agent's run fixing a
 * ticket that was never shown to be broken, which is more restraint than most
 * change boards manage.
 */

import { readReadiness, type ReadinessSettings, type RulesReading } from '../src/model/readiness.ts';
import { itemEvidence, itemRevision, itemText, type ItemEvidence, JUDGE_BATCH, MAX_JUDGE_ITEMS, readingOf, readJudgement, ruleIn, ruleRevision, type JudgeAgent, type JudgeRequest, type JudgeResult, type JudgingNow, type RuleFound, type RulesBackend, type RuleVerdict, type RulesView, type StandardSummary } from '../src/rules.ts';
import type { Execute, WorkItem } from '../src/toil.ts';
import { JUDGE_SYSTEM, judgePrompt } from './assign/prompts.ts';
import { jsonIn } from './classify.ts';
import { CALLER } from './store.ts';

/** A verdict as kept: the page's, with the item and what it was judged on. */
export interface StoredVerdict extends RuleVerdict {
  item: string;
  /** The hash of the item's text as the agent read it, when judged. */
  itemRev: string;
  /** The rule's text's hash when judged. */
  ruleRev: string;
}

/** Where verdicts are kept: the cache for the server, memory for the sample and the tests. One per item and rule, the newest. */
export interface VerdictKeeper {
  load(toilProject: string): StoredVerdict[];
  save(toilProject: string, verdicts: readonly StoredVerdict[]): void;
}

/** A keeper in memory: the sample's, and the tests'. */
export function memoryVerdicts(seed: Record<string, StoredVerdict[]> = {}): VerdictKeeper {
  const kept = new Map<string, Map<string, StoredVerdict>>(Object.entries(seed).map(([tp, vs]) => [tp, new Map(vs.map((v) => [`${v.item}\n${v.standard}/${v.rule}`, v]))]));
  return {
    load: (tp) => [...(kept.get(tp)?.values() ?? [])].map((v) => ({ ...v })),
    save: (tp, vs) => {
      const m = kept.get(tp) ?? new Map<string, StoredVerdict>();
      for (const v of vs) m.set(`${v.item}\n${v.standard}/${v.rule}`, { ...v });
      kept.set(tp, m);
    },
  };
}

/** The cache's keeper: one row per item and rule (ui/server/cache.ts, schema 7). `cache` is a getter so a wipe can swap the file underneath. */
export function cacheVerdicts(cache: () => { saveRuleVerdicts(tp: string, vs: readonly StoredVerdict[]): void; ruleVerdicts<T>(tp: string): T[] }): VerdictKeeper {
  return { load: (tp) => cache().ruleVerdicts<StoredVerdict>(tp), save: (tp, vs) => cache().saveRuleVerdicts(tp, vs) };
}

/** What runs an AI agent on a prompt with no tool, and which one a press would ask. */
export interface JudgeAgents {
  current(): Promise<JudgeAgent | null> | JudgeAgent | null;
  run(request: { toilProject: string; system: string; prompt: string; signal: AbortSignal }): Promise<{ text: string; by: string }>;
}

export interface StandardsOptions {
  execute: Execute;
  /** The toil project's synced items, or null when it has never synced. */
  items(toilProject: string): WorkItem[] | null;
  keeper: VerdictKeeper;
  /** The person's agent; null where none can run (the tests that only read). */
  agents: JudgeAgents | null;
  /** How long one press may run: the assignments' time limit. */
  timeLimitMs(): number;
  now?: () => string;
  /** The folder toil looks from, for a repository's checked-in rules; process.cwd() by default. */
  cwd?: string;
}

/** A refusal in the words the page shows: what happened, and what to do. */
export class StandardsRefusal extends Error {
  constructor(message: string, readonly fix: string, readonly status = 400) {
    super(message);
  }
}

/** The most ids one request may name: past this the page is sending something other than a sprint. */
const MAX_REQUEST_IDS = 1000;

interface Context {
  standards: StandardSummary[];
  warnings: string[];
  items: WorkItem[] | null;
  settings: ReadinessSettings;
}

export class StandardsService implements RulesBackend {
  private readonly busy = new Map<string, JudgingNow>();
  private readonly now: () => string;

  constructor(private readonly o: StandardsOptions) {
    this.now = o.now ?? (() => new Date().toISOString());
  }

  private async context(toilProject: string): Promise<Context> {
    const cwd = this.o.cwd ?? process.cwd();
    const listed = await this.o.execute('standards list', { toilProject, cwd }, { readOnly: true, caller: CALLER });
    if (!listed.ok) throw new StandardsRefusal(`toil couldn't read the ticket rules: ${listed.error.message}`, listed.error.fix ?? 'Fix that, then open the page again.');
    const shown = await this.o.execute('projects show', { toilProject }, { readOnly: true, caller: CALLER });
    const settings = readReadiness(shown.ok ? (shown.data as { toilProject?: unknown } | null)?.toilProject : null);
    const data = listed.data as { standards?: StandardSummary[] } | null;
    // STANDARDS_NONE says what the empty list already shows, so it isn't repeated as a warning on the page.
    const warnings = (listed.meta.warnings ?? []).filter((w) => w.code !== 'STANDARDS_NONE').map((w) => w.message);
    return { standards: data?.standards ?? [], warnings, items: this.o.items(toilProject), settings };
  }

  /** Each item's text and revision, as the agent reads it and a verdict is keyed on. */
  private texts(ctx: Context, items: readonly WorkItem[]): Map<string, { text: string; rev: string; evidence: ItemEvidence }> {
    return new Map(
      items.map((i) => {
        const field = ctx.settings.areas[i.source.area]?.acceptanceField ?? null;
        const text = itemText(i, field);
        return [i.id, { text, rev: itemRevision(text), evidence: itemEvidence(i, field) }];
      }),
    );
  }

  /** The verdicts that still hold: judged on the item's current revision and the rule's current text. */
  private current(toilProject: string, ctx: Context): Record<string, RuleVerdict[]> {
    if (!ctx.items) return {};
    const rules = new Map(ctx.standards.flatMap((s) => s.rules.map((r) => [`${s.name}/${r.id}`, { name: r.name, rev: ruleRevision(r) }])));
    const texts = this.texts(ctx, ctx.items);
    const out: Record<string, RuleVerdict[]> = {};
    for (const v of this.o.keeper.load(toilProject)) {
      const named = rules.get(`${v.standard}/${v.rule}`);
      if (!named || named.rev !== v.ruleRev || texts.get(v.item)?.rev !== v.itemRev) continue;
      const { item, standard, rule, name, verdict: said, reason, quote, note, by, at } = v;
      const verdict: RuleVerdict = { standard, rule, name, verdict: said, reason, quote, note, by, at };
      (out[item] ??= []).push({ ...verdict, name: named.name });
    }
    return out;
  }

  private async agent(): Promise<JudgeAgent | null> {
    return this.o.agents ? await this.o.agents.current() : null;
  }

  async read(toilProject: string): Promise<RulesView> {
    const ctx = await this.context(toilProject);
    return { toilProject, standards: ctx.standards, verdicts: this.current(toilProject, ctx), synced: ctx.items !== null, warnings: ctx.warnings, agent: await this.agent(), judging: this.busy.get(toilProject) ?? null };
  }

  /**
   * Judges these items on every rule the toil project names, with the person's
   * agent, on their press: the items whose every verdict still holds are left
   * alone, at most MAX_JUDGE_ITEMS are asked about, JUDGE_BATCH to one agent
   * call, and the whole press stops at the assignments' time limit, keeping
   * what each finished batch said. One press per toil project at a time.
   */
  async judge(toilProject: string, request: JudgeRequest, signal?: AbortSignal): Promise<JudgeResult> {
    const ids = request?.items;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === 'string' && i.length > 0 && i.length <= 300)) {
      throw new StandardsRefusal('Name the items to judge by their OWI ids.', 'Send { "items": ["<owi id>", …] }.');
    }
    if (ids.length > MAX_REQUEST_IDS) throw new StandardsRefusal(`That is ${ids.length} items; one request names at most ${MAX_REQUEST_IDS}.`, 'Judge a sprint or a filtered list at a time.');
    if (this.busy.has(toilProject)) throw new StandardsRefusal(`Your AI agent is already judging ${toilProject}'s ticket rules.`, 'Wait for it to finish; the page says when it has.', 409);
    // The slot is claimed before the first await, so two presses arriving together can't both pass the check above.
    this.busy.set(toilProject, { items: ids.length, by: 'Your AI agent', startedAt: this.now() });
    try {
      return await this.judgeClaimed(toilProject, ids, signal);
    } finally {
      this.busy.delete(toilProject);
    }
  }

  /** The press itself, once judge() holds the toil project's slot. */
  private async judgeClaimed(toilProject: string, ids: readonly string[], signal?: AbortSignal): Promise<JudgeResult> {
    if (!this.o.agents) throw new StandardsRefusal('This Toil UI has no AI agent to judge ticket rules with.', 'Start toil-ui with its cache, or with --sample for the sample.', 404);
    const agents = this.o.agents;
    const agent = await this.agent();
    if (!agent) throw new StandardsRefusal('No AI agent is set up yet, so nothing can judge the ticket rules.', 'Choose one under Settings, AI agent, then press Check with AI agent again.', 404);
    if (agent.problem) throw new StandardsRefusal(agent.problem, 'Set it up under Settings, AI agent, then press Check with AI agent again.', 409);
    const ctx = await this.context(toilProject);
    if (!ctx.items) throw new StandardsRefusal(`Toil UI hasn't synced ${toilProject} yet, so there is nothing to judge.`, 'Press Sync now in the Sync panel, then check again.', 409);
    const rules = ctx.standards.flatMap((s) => s.rules.map((r) => ({ standard: s.name, rule: r.id, name: r.name, text: r.text })));
    if (!rules.length) throw new StandardsRefusal(`${toilProject} names no ticket rules, so there is nothing to judge.`, 'Choose its rules under Settings, Ticket rules.', 409);
    const byId = new Map(ctx.items.map((i) => [i.id, i]));
    const unknown = ids.filter((id) => !byId.has(id));
    if (unknown.length) throw new StandardsRefusal(`${toilProject} has no item ${unknown[0]} in Toil UI's last sync.`, 'Sync the Toil project, or judge items its pages list.', 404);
    const wanted = [...new Set(ids)].map((id) => byId.get(id)!);
    const held = this.current(toilProject, ctx);
    const todo = wanted.filter((i) => rules.some((r) => !held[i.id]?.some((v) => v.standard === r.standard && v.rule === r.rule)));
    const take = todo.slice(0, MAX_JUDGE_ITEMS);
    let left = todo.length - take.length;
    const notes: string[] = [];
    if (left > 0) notes.push(`One press judges ${MAX_JUDGE_ITEMS} items; ${left} more ${left === 1 ? 'is' : 'are'} left for the next.`);
    let judged = 0;
    if (take.length) {
      const texts = this.texts(ctx, take);
      const controller = new AbortController();
      const limit = this.o.timeLimitMs();
      const timer = setTimeout(() => controller.abort('time'), limit);
      const stop = () => controller.abort('cancelled');
      // A press cancelled before it got here never fires 'abort' again, so it is read as it stands.
      if (signal?.aborted) stop();
      else signal?.addEventListener('abort', stop, { once: true });
      this.busy.set(toilProject, { items: take.length, by: agent.label, startedAt: this.now() });
      const why = () => (controller.signal.reason === 'time' ? `It stopped at the time limit of ${Math.round(limit / 60_000)} minutes.` : 'It was stopped.');
      try {
        for (let at = 0; at < take.length; at += JUDGE_BATCH) {
          const rest = take.length - at;
          if (controller.signal.aborted) {
            notes.push(`${why()} ${rest} item${rest === 1 ? ' is' : 's are'} not judged yet.`);
            left += rest;
            break;
          }
          const batch = take.slice(at, at + JUDGE_BATCH).map((i) => ({ id: i.id, text: texts.get(i.id)!.text, evidence: texts.get(i.id)!.evidence }));
          let answer: { text: string; by: string };
          try {
            answer = await agents.run({ toilProject, system: JUDGE_SYSTEM, prompt: judgePrompt(rules, batch), signal: controller.signal });
          } catch (e) {
            if (judged === 0 && !controller.signal.aborted) throw new StandardsRefusal(`Your AI agent couldn't judge the ticket rules. It failed: ${e instanceof Error ? e.message : String(e)}`, 'Check it under Settings, AI agent, then press Check with AI agent again.', 502);
            notes.push(`${controller.signal.aborted ? why() : `It failed: ${e instanceof Error ? e.message : String(e)}`} ${rest} item${rest === 1 ? ' is' : 's are'} not judged yet.`);
            left += rest;
            break;
          }
          let parsed: unknown = null;
          const json = jsonIn(answer.text, '[');
          try {
            parsed = json === null ? null : JSON.parse(json);
          } catch {
            parsed = null;
          }
          const read = readJudgement(parsed, batch, rules, answer.by, this.now());
          notes.push(...read.notes);
          const revOf = new Map(rules.map((r) => [`${r.standard}/${r.rule}`, ruleRevision(r)]));
          this.o.keeper.save(
            toilProject,
            read.verdicts.map((v) => ({ ...v, itemRev: texts.get(v.item)!.rev, ruleRev: revOf.get(`${v.standard}/${v.rule}`)! })),
          );
          judged += new Set(read.verdicts.map((v) => v.item)).size;
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
      }
    }
    return { view: await this.read(toilProject), judged, current: wanted.length - todo.length, left, by: agent.label, notes: [...new Set(notes)] };
  }

  /** One rule on one item, with its text and its verdict now; null when the toil project doesn't name it. */
  async ruleFor(toilProject: string, item: string, standard: string, rule: string): Promise<RuleFound | null> {
    return ruleIn(readingOf(await this.read(toilProject)), item, standard, rule);
  }

  /** The reading the agent's readiness tools hold rows to, as the page holds them: a failure is a reading too. */
  async reading(toilProject: string): Promise<RulesReading> {
    try {
      return readingOf(await this.read(toilProject));
    } catch (e) {
      return readingOf(null, e instanceof Error ? e.message : String(e));
    }
  }
}
