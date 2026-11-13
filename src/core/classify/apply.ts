/**
 * What the three trackers' `categorize` commands share once a plan is read:
 * the label arithmetic, the result's shape, and the words for what went wrong.
 * Each tracker keeps its own requests; everything a caller reads is built
 * here, so Jira, GitHub and Azure DevOps answer one question one way
 * (principle 10). Three teams were otherwise going to phrase "the field is
 * missing" three ways and schedule a sync to reconcile them.
 */
import type { Warning } from '../envelope.js';
import { ToilError } from '../errors.js';
import { NOTHING_TO_CATEGORIZE, skippedWarning, type SkippedGroup } from './plan.js';
import type { CategorizeChange, CategorizeResult, ClassifyArea, ClassifyPlan, PlanGroup } from './types.js';

/**
 * A backlog is hundreds of items and each is a request or two, so a
 * `categorize` call gets longer than the default two minutes. Running a plan
 * twice changes nothing, so a rerun after `TIMEOUT` picks up where it stopped.
 */
export const CATEGORIZE_TIME_LIMIT_MS = 15 * 60_000;

/** What a person calls each tracker, for a message. */
const TRACKER: Record<ClassifyArea, string> = { jira: 'Jira', github: 'GitHub', ado: 'Azure DevOps' };

/**
 * What must change on one item's labels, from the labels it carries right now:
 * the category's label when it's missing, and every other label of the scheme
 * when it's there. Labels compare without regard to case, the way the trackers
 * treat them (GitHub and Azure DevOps hold one spelling; Jira holds both and a
 * team means one). A label to remove is spelled as the item spells it; nothing
 * outside the plan group's own `labels` map is ever named. The command can't
 * look the scheme up, so that map is the plan's word for which labels are the
 * scheme's; `toil classify run` builds it from the scheme.
 */
export function labelChange(current: readonly string[], group: Pick<PlanGroup, 'labels'>, category: string): { add: string[]; remove: string[] } {
  const want = group.labels[category];
  if (want === undefined) return { add: [], remove: [] };
  const others = new Set(Object.entries(group.labels).filter(([id]) => id !== category).map(([, label]) => label.toLowerCase()));
  others.delete(want.toLowerCase());
  const has = current.some((label) => label.toLowerCase() === want.toLowerCase());
  return { add: has ? [] : [want], remove: current.filter((label) => others.has(label.toLowerCase())) };
}

/** An item's labels after `labelChange`, in the order it had them, with the category's label last. */
export function labelsAfter(current: readonly string[], change: { add: string[]; remove: string[] }): string[] {
  const gone = new Set(change.remove);
  return [...current.filter((label) => !gone.has(label)), ...change.add];
}

/** Whether two field values are the same option: trimmed, without regard to case. An unread or empty value matches nothing. */
export function sameValue(current: string | null | undefined, wanted: string): boolean {
  return typeof current === 'string' && current.trim().toLowerCase() === wanted.trim().toLowerCase();
}

/** The tracker has no field by the name the toil project gave. Thrown before any write. */
export function fieldNotFound(area: ClassifyArea, name: string, where?: string): ToilError {
  const tracker = TRACKER[area];
  return new ToilError('NOT_FOUND', `${tracker} has no field named "${name}"${where ? ` ${where}` : ''}.`, {
    fix: `A ${tracker} admin creates the field; toil never creates one. Then name it in the toil project: toil projects classify set <toil-project> --target ${area}.field=<field>. To write labels only, drop the target: toil projects classify set <toil-project> --clear ${area}.`,
  });
}

/** The field exists but the plan would set it to something it doesn't offer. Thrown before any write. */
export function optionMissing(area: ClassifyArea, field: string, value: string, category: string, options: readonly string[]): ToilError {
  return new ToilError('INVALID_INPUT', `The field "${field}" has no option "${value}", the value for the category "${category}". It has: ${options.length > 0 ? options.join(', ') : 'no options'}.`, {
    fix: `Add the option in ${TRACKER[area]}, or map the category to an option the field has: toil projects classify set <toil-project> --target ${area}.value.${category}=<option>.`,
  });
}

/** Items whose type doesn't carry the field: they got the label and no field value. Undefined when there are none. */
export function fieldNotOnType(field: string, types: ReadonlyArray<{ type: string; items: number }>): Warning | undefined {
  if (types.length === 0) return undefined;
  const named = types.map((t) => `${t.type} (${t.items} ${t.items === 1 ? 'item' : 'items'})`).join(', ');
  return {
    code: 'CATEGORIZE_FIELD_NOT_ON_TYPE',
    message: `The field "${field}" isn't on ${named}, so those got the label and no field value. An admin adds the field to the type; then run the same plan again.`,
  };
}

/**
 * One item's failure, as `failed` records it, or a rethrow when going on would
 * only repeat it: the credential was refused outright (401), the network is
 * down, or the error isn't one a tracker sent. A 403 or 404 on one item is that
 * item's problem and the rest of the plan still applies. Where items have
 * already been processed, the caller passes `progress` and a rethrown
 * `ToilError` carries it as `details.categorize`; anything that isn't a
 * `ToilError` is rethrown untouched.
 */
export function failureReason(err: unknown, progress?: () => CategorizeProgress): string {
  if (!(err instanceof ToilError)) throw err;
  const status = (err.details as { status?: unknown } | undefined)?.status;
  const stops = err.code === 'NETWORK' || err.code === 'TIMEOUT' || err.code === 'CANCELLED' || err.code === 'INTERNAL' || (err.code === 'AUTH' && status !== 403);
  if (stops) throw progress ? stoppedAfter(err, progress()) : err;
  return err.message;
}

/** How far a run got: the counts a result carries, taken at the moment an error stopped it. */
export type CategorizeProgress = CategorizeResult['counts'];

/**
 * The same error with the record of what the run had done, so a failure
 * envelope doesn't hide writes that were made. Code, message and fix are kept,
 * and so is every detail the error already had.
 */
function stoppedAfter(err: ToilError, progress: CategorizeProgress): ToilError {
  const processed = progress.changed + progress.unchanged + progress.failed;
  if (processed === 0) return err;
  const before = progress.changed > 0 ? ` ${progress.changed} of ${progress.planned} ${progress.planned === 1 ? 'item was' : 'items were'} changed before this.` : '';
  const had = typeof err.details === 'object' && err.details !== null && !Array.isArray(err.details) ? err.details : err.details === undefined ? {} : { error: err.details };
  return new ToilError(err.code, `${err.message}${before}`, {
    ...(err.fix !== undefined ? { fix: err.fix } : {}),
    details: { ...had, categorize: progress },
  });
}

/** An issue type as a message names it: its project first, so two projects' "Bug" are two things. */
export function typeLabel(project: string, type: string): string {
  return [project, type || 'unknown type'].filter(Boolean).join(' ');
}

/** The result every `categorize` returns, with the counts worked out from the lists. */
export function categorizeResult(o: {
  connection: string;
  plan: ClassifyPlan;
  group: PlanGroup | undefined;
  field: CategorizeResult['field'];
  skipped: SkippedGroup[];
  changed: CategorizeChange[];
  unchanged: string[];
  failed: Array<{ key: string; reason: string }>;
}): CategorizeResult {
  return {
    connection: o.connection,
    scheme: o.plan.scheme,
    field: o.field,
    changed: o.changed,
    unchanged: o.unchanged,
    failed: o.failed,
    skipped: o.skipped,
    counts: { planned: o.group?.items.length ?? 0, changed: o.changed.length, unchanged: o.unchanged.length, failed: o.failed.length },
  };
}

/**
 * The warnings every `categorize` result carries, worded once: nothing to do,
 * entries for other connections left alone, and items that failed. A failed
 * item never fails the command, since the others were changed and the
 * envelope has to say so; the warning is what makes it impossible to miss.
 */
export function categorizeWarnings(result: CategorizeResult): Warning[] {
  const warnings: Warning[] = [];
  if (result.counts.planned === 0) warnings.push(NOTHING_TO_CATEGORIZE);
  const skipped = skippedWarning(result.skipped);
  if (skipped) warnings.push(skipped);
  if (result.failed.length > 0) {
    const shown = result.failed.slice(0, 5).map((f) => `${f.key} (${f.reason})`).join('; ');
    const more = result.failed.length > 5 ? `; and ${result.failed.length - 5} more in data.failed` : '';
    warnings.push({
      code: 'CATEGORIZE_FAILED',
      message: `${result.failed.length} of ${result.counts.planned} ${result.counts.planned === 1 ? 'item was' : 'items were'} not changed: ${shown}${more}. The rest were applied. Fix what each reason names, then run the same plan again: items already changed are left alone.`,
    });
  }
  return warnings;
}
