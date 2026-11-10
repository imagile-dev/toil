import { describe, expect, it } from 'vitest';
import { memoryFiles } from '../../../test/harness/files.js';
import { ToilError } from '../errors.js';
import { planFor, readPlanFrom, skippedWarning, NOTHING_TO_CATEGORIZE } from './plan.js';
import type { ClassifyPlan, PlanGroup } from './types.js';

const group = (extra: Partial<PlanGroup> = {}): PlanGroup => ({
  area: 'jira',
  connection: 'corp-jira',
  labels: { ktlo: 'ktlo', feature: 'feature' },
  items: [{ id: 'corp-jira:PAY-1', key: 'PAY-1', category: 'ktlo', labels: { add: ['ktlo'], remove: ['Feature'] } }],
  ...extra,
});
const plan = (...groups: PlanGroup[]): ClassifyPlan => ({
  scheme: { name: 'ktlo-feature', revision: 2 },
  categories: [
    { id: 'ktlo', short: 'KTLO', name: 'Keep the lights on', label: 'ktlo', definition: 'd' },
    { id: 'feature', short: 'Feature', name: 'Feature', label: 'feature', definition: 'd' },
  ],
  plan: groups,
});
const read = (text: string, from: string | undefined = 'plan.json', files = memoryFiles({ 'plan.json': text }, { stdin: text })) => readPlanFrom({ files }, from);
const refusal = (fn: () => unknown): ToilError => {
  try {
    fn();
  } catch (err) {
    return err as ToilError;
  }
  throw new Error('expected a refusal');
};

describe('readPlanFrom', () => {
  it('reads bare data', () => {
    expect(read(JSON.stringify(plan(group())))).toEqual(plan(group()));
  });

  it('reads the envelope, taking the plan from data and ignoring the rest of the result', () => {
    const envelope = { ok: true, data: { ...plan(group()), toilProject: 'p', verdicts: [], summary: {} }, error: null, meta: { command: 'classify run' } };
    expect(read(JSON.stringify(envelope)).plan).toEqual([group()]);
  });

  it('reads stdin when from is omitted or "-"', () => {
    const text = JSON.stringify(plan(group()));
    expect(read(text, undefined).plan).toHaveLength(1);
    expect(read(text, '-').plan).toHaveLength(1);
  });

  it('says there is no stdin over MCP', () => {
    const err = refusal(() => readPlanFrom({ files: memoryFiles({}) }, undefined));
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('Over MCP');
  });

  it('refuses a failed envelope, naming its message', () => {
    const err = refusal(() => read(JSON.stringify({ ok: false, data: null, error: { code: 'X', message: 'no scheme' }, meta: {} })));
    expect(err.message).toContain('failed result: no scheme');
  });

  it('refuses non-JSON, and JSON with no plan list', () => {
    expect(refusal(() => read('nope')).message).toContain("isn't JSON");
    expect(refusal(() => read('{"items":[]}')).message).toContain('no plan list');
    expect(refusal(() => read('[]')).message).toContain('no plan list');
  });

  it('refuses a label the scheme does not own, in add or remove', () => {
    for (const labels of [{ add: ['bug'], remove: [] }, { add: ['ktlo'], remove: ['urgent'] }]) {
      const bad = group({ items: [{ id: 'a', key: 'A-1', category: 'ktlo', labels }] });
      const err = refusal(() => read(JSON.stringify(plan(bad))));
      expect(err.code).toBe('INVALID_INPUT');
      expect(err.message).toContain("is not one of the scheme's labels");
    }
  });

  it('compares labels without regard to case', () => {
    const ok = group({ items: [{ id: 'a', key: 'A-1', category: 'ktlo', labels: { add: ['KTLO'], remove: ['FEATURE'] } }] });
    expect(read(JSON.stringify(plan(ok))).plan).toHaveLength(1);
  });

  it('refuses a second entry for one connection, a category with no label, and a field value with no field', () => {
    expect(refusal(() => read(JSON.stringify(plan(group(), group())))).message).toContain('a second entry for jira connection "corp-jira"');
    const unlabelled = group({ items: [{ id: 'a', key: 'A-1', category: 'chore', labels: { add: [], remove: [] } }] });
    expect(refusal(() => read(JSON.stringify(plan(unlabelled)))).message).toContain('has no label');
    const orphanField = group({ items: [{ id: 'a', key: 'A-1', category: 'ktlo', labels: { add: [], remove: [] }, field: { value: 'KTLO' } }] });
    expect(refusal(() => read(JSON.stringify(plan(orphanField)))).message).toContain('no field named');
  });

  it('accepts a field with its name and project', () => {
    const withField = group({ area: 'github', connection: 'github', field: { name: 'Work', project: 'imagile/3' }, items: [{ id: 'a', key: 'x#1', category: 'ktlo', labels: { add: [], remove: [] }, field: { value: 'KTLO' } }] });
    expect(read(JSON.stringify(plan(withField))).plan[0]!.field).toEqual({ name: 'Work', project: 'imagile/3' });
  });
});

describe('planFor', () => {
  const jira = group();
  const ado = group({ area: 'ado', connection: 'corp-ado' });
  const other = group({ connection: 'other-jira', items: [] });

  it("returns the connection's group and names the rest as skipped", () => {
    expect(planFor(plan(jira, ado, other), 'jira', 'corp-jira')).toEqual({
      group: jira,
      skipped: [{ area: 'ado', connection: 'corp-ado', items: 1 }, { area: 'jira', connection: 'other-jira', items: 0 }],
    });
  });

  it('returns no group, and nothing skipped, for an empty plan', () => {
    expect(planFor(plan(), 'jira', 'corp-jira')).toEqual({ group: undefined, skipped: [] });
  });

  it('refuses a plan with nothing for the connection, suggesting the connection of that area', () => {
    const err = refusal(() => planFor(plan(jira, other), 'jira', 'wrong'));
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('jira "corp-jira", jira "other-jira"');
    expect(err.fix).toContain('<one of corp-jira, other-jira>');
    expect(refusal(() => planFor(plan(jira), 'jira', 'wrong')).fix).toContain('--connection corp-jira');
    expect(refusal(() => planFor(plan(jira), 'github', 'gh')).fix).toContain('no github items');
  });
});

describe('skippedWarning', () => {
  it('is undefined with nothing skipped', () => {
    expect(skippedWarning([])).toBeUndefined();
  });

  it('names each entry with its count, singular or plural', () => {
    const w = skippedWarning([{ area: 'ado', connection: 'corp-ado', items: 1 }, { area: 'jira', connection: 'j2', items: 4 }]);
    expect(w?.code).toBe('CATEGORIZE_SKIPPED');
    expect(w?.message).toContain('ado "corp-ado" (1 item), jira "j2" (4 items)');
  });

  it('has a fixed warning for a plan with nothing to do', () => {
    expect(NOTHING_TO_CATEGORIZE.code).toBe('CATEGORIZE_NOTHING');
  });
});
