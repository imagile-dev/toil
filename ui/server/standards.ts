/**
 * Ticket rules on the server (#657): toil's own `standards check`, run
 * read-only and in-process over the items the cache synced for a toil
 * project, so there is no request body to outgrow and no file to stage. The
 * page asks `GET api/standards?toilProject=<name>` and gets toil's result as
 * toil printed it, or null when the toil project hasn't synced (not read yet,
 * never an empty check). Each toil project's answer is kept until its next
 * sync, since nothing a rule reads can change between syncs. The rules
 * themselves, a team's own files or the built-in ones, are found by toil from
 * the toil project's `standards.use`; this file never reads one.
 *
 * `ruleFor` is what the assignment queue asks before it queues a "Fix with AI
 * agent": the one rule on the one item, with the rule's text, from the same
 * check. A rule that passes, doesn't apply or couldn't be read is refused
 * there, so nobody spends an agent's run fixing a ticket that was never
 * broken, which is more restraint than most change boards manage.
 */

import type { StandardsCheckResult } from '../../src/core/standards/types.ts';
import type { RulesReading } from '../src/model/readiness.ts';
import { readingOf, ruleIn, type RuleFound, type RulesBackend, type RulesView } from '../src/rules.ts';
import type { Execute, WorkItem } from '../src/toil.ts';
import { CALLER } from './store.ts';

export interface StandardsOptions {
  execute: Execute;
  /** The toil project's synced items, or null when it has never synced. */
  items(toilProject: string): WorkItem[] | null;
  /** When the toil project was last synced: an answer is kept until this changes. */
  syncedAt(toilProject: string): string | null;
  /** The folder toil looks from, for a repository's checked-in rules; process.cwd() by default. */
  cwd?: string;
}

/** A refusal in the words the page shows: what happened, and what to do. */
export class StandardsRefusal extends Error {
  constructor(message: string, readonly fix: string, readonly status = 400) {
    super(message);
  }
}

export class StandardsService implements RulesBackend {
  private readonly kept = new Map<string, { at: string | null; view: Promise<RulesView> }>();

  constructor(private readonly o: StandardsOptions) {}

  /** toil's check over the toil project's synced items, kept until its next sync. */
  check(toilProject: string): Promise<RulesView> {
    const at = this.o.syncedAt(toilProject);
    const had = this.kept.get(toilProject);
    if (had && had.at === at) return had.view;
    const view = this.run(toilProject);
    this.kept.set(toilProject, { at, view });
    // A failure is said once and asked again next time, not kept until the next sync.
    view.catch(() => this.kept.delete(toilProject));
    return view;
  }

  private async run(toilProject: string): Promise<RulesView> {
    const items = this.o.items(toilProject);
    if (!items || items.length === 0) return { result: null, warnings: [] };
    const e = await this.o.execute('standards check', { toilProject, text: JSON.stringify(items), cwd: this.o.cwd ?? process.cwd() }, { readOnly: true, caller: CALLER });
    if (!e.ok) throw new StandardsRefusal(`toil couldn't check the ticket rules: ${e.error.message}`, e.error.fix ?? 'Fix that, then sync again.');
    return { result: e.data as StandardsCheckResult, warnings: (e.meta.warnings ?? []).map((w) => w.message) };
  }

  /** One rule's outcome on one item, with its text, from the toil project's last check; null when it doesn't apply. */
  async ruleFor(toilProject: string, item: string, standard: string, rule: string): Promise<RuleFound | null> {
    const { result } = await this.check(toilProject);
    return result ? ruleIn(result, item, standard, rule) : null;
  }

  /** The reading the agent's readiness tools hold rows to, as the page holds them: a failure is a reading too. */
  async reading(toilProject: string): Promise<RulesReading> {
    try {
      return readingOf(await this.check(toilProject));
    } catch (e) {
      return readingOf(null, e instanceof Error ? e.message : String(e));
    }
  }
}
