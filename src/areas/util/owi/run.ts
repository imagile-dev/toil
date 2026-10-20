import type { CommandContext } from '../../../core/context.js';
import { authorKinds, documentsFrom, fieldOverrides, keyPatterns, mapOwi, parseOwiInput, OWI_VERSION, type Change, type OrphanHistory, type OwiSkipped, type WorkItem } from '../../../core/owi/index.js';
import type { UtilInput } from '../kit/input.js';
import { Verifier, type Verified } from '../kit/verify.js';

/**
 * The work of `util owi map`, loaded only when it runs (docs/util.md, Lazy
 * loading): parse the input, map it with the core mappers, then check every
 * item against docs/owi/schema.json in the bounded worker before returning
 * it. The schema is the one the spec publishes, bundled as JSON, so what is
 * checked here is exactly what a reader of the spec would check. Checking
 * one's own paperwork against the published form is, for once, the whole job.
 */

export interface OwiMapInput {
  text: string;
  source: UtilInput;
  command?: string | undefined;
  key?: string | undefined;
  field?: string[] | undefined;
  keyPattern?: string[] | undefined;
  authorKind?: string[] | undefined;
}

export interface OwiMapOutput {
  owi: typeof OWI_VERSION;
  count: number;
  items: WorkItem[];
  changes: Change[];
  histories: OrphanHistory[];
  unmapped: Record<string, number>;
  skipped: OwiSkipped[];
  verified: Verified;
}

export async function mapOwiInput(ctx: Pick<CommandContext, 'warn' | 'signal'>, input: OwiMapInput): Promise<OwiMapOutput> {
  const fields = fieldOverrides(input.field);
  const keys = keyPatterns(input.keyPattern);
  const authors = authorKinds(input.authorKind);
  const { documents, skipped } = documentsFrom(parseOwiInput(input.text), { command: input.command, key: input.key });
  const result = mapOwi(documents, { fields, skipped, keys, authors });
  for (const warning of result.warnings) ctx.warn(warning);

  const unmapped: Record<string, number> = {};
  const records = [...result.items, ...result.changes];
  for (const record of records) for (const { field } of record.unmapped) unmapped[field] = (unmapped[field] ?? 0) + 1;
  const withGaps = records.filter((i) => i.unmapped.length > 0).length;
  if (withGaps > 0) {
    const counts = Object.entries(unmapped).map(([field, n]) => `${field} (${n})`).join(', ');
    const what = result.changes.length ? 'records' : 'items';
    ctx.warn({ code: 'OWI_UNMAPPED', message: `${withGaps} of ${records.length} ${what} have fields that couldn't be mapped: ${counts}. Each one's unmapped says why.` });
  }

  const v = new Verifier(ctx.warn);
  await checkAgainstSchema(v, result.items, result.histories, ctx.signal, result.changes);
  v.inputComplete(input.source);

  return { owi: OWI_VERSION, count: result.items.length, items: result.items, changes: result.changes, histories: result.histories, unmapped, skipped: result.skipped, verified: v.done() };
}

/**
 * Validates every item, every history that joined no item, and every change,
 * against docs/owi/schema.json in the bounded worker, recording one run of
 * `items.schema` (or `histories.schema`, or `changes.schema`) each. A validation that couldn't
 * finish is unchecked, never passed.
 */
export async function checkAgainstSchema(v: Verifier, items: WorkItem[], histories: OrphanHistory[], signal?: AbortSignal, changes: Change[] = []): Promise<void> {
  const [{ validateBounded }, { leafProblems }, schema] = await Promise.all([
    import('../kit/bounded.js'),
    import('../kit/json-schema.js'),
    import('../../../../docs/owi/schema.json', { with: { type: 'json' } }).then((m) => m.default as Record<string, unknown>),
  ]);
  const id = String(schema.$id);
  const check = async (name: string, value: unknown, at: string, def: string) => {
    const outcome = await validateBounded({ $ref: `${id}#/$defs/${def}` } as never, value, { signal, key: `owi-${schema.title}-${def}`, references: [{ schema: schema as never }] });
    if (outcome.unchecked) return v.unchecked(name, outcome.unchecked);
    const problem = leafProblems(outcome.problems)[0];
    v.expect(name, outcome.valid, { at, expected: 'valid against docs/owi/schema.json', actual: problem ? `${problem.pointer || '/'}: ${problem.message}` : 'invalid' }, { code: 'OWI_SCHEMA_INVALID' });
  };
  for (const [i, item] of items.entries()) await check('items.schema', item, `items[${i}] (${item.id})`, 'WorkItem');
  for (const [i, orphan] of histories.entries()) await check('histories.schema', orphan.history, `histories[${i}] (${orphan.id})`, 'History');
  for (const [i, change] of changes.entries()) await check('changes.schema', change, `changes[${i}] (${change.id})`, 'Change');
  if (items.length === 0 && histories.length === 0 && changes.length === 0) v.unchecked('items.schema', 'the input mapped to no items or changes');
}
