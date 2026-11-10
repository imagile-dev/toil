/**
 * Pins down what the three trackers' `categorize` commands share: the label
 * arithmetic (what to add, what to remove, what the item ends up with), the
 * words for a missing field or option, which per-item failures are recorded
 * and which stop the run, and the result and warnings every tracker returns.
 * A change here changes Jira, GitHub and Azure DevOps at once. The suite exists
 * so that happens by decision and not by an unminuted Thursday merge.
 */
import { describe, expect, it } from 'vitest';
import { ToilError } from '../errors.js';
import { NOTHING_TO_CATEGORIZE } from './plan.js';
import {
  categorizeResult,
  categorizeWarnings,
  failureReason,
  fieldNotFound,
  fieldNotOnType,
  labelChange,
  labelsAfter,
  optionMissing,
  sameValue,
} from './apply.js';
import type { CategorizeResult, ClassifyPlan, PlanGroup } from './types.js';

const group = (extra: Partial<PlanGroup> = {}): PlanGroup => ({
  area: 'jira',
  connection: 'corp-jira',
  labels: { ktlo: 'ktlo', feature: 'feature' },
  items: [
    { id: 'corp-jira:PAY-101', key: 'PAY-101', category: 'ktlo', labels: { add: ['ktlo'], remove: [] } },
    { id: 'corp-jira:PAY-102', key: 'PAY-102', category: 'feature', labels: { add: ['feature'], remove: [] } },
  ],
  ...extra,
});
const plan = (...groups: PlanGroup[]): ClassifyPlan => ({
  scheme: { name: 'ktlo-feature', revision: 2 },
  categories: [],
  plan: groups,
});
const result = (extra: Partial<CategorizeResult> = {}): CategorizeResult => ({
  connection: 'corp-jira',
  scheme: { name: 'ktlo-feature', revision: 2 },
  field: null,
  changed: [],
  unchanged: [],
  failed: [],
  skipped: [],
  counts: { planned: 2, changed: 0, unchanged: 2, failed: 0 },
  ...extra,
});
const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
};

describe('labelChange', () => {
  it("adds the category's label when the item lacks it", () => {
    expect(labelChange([], group(), 'ktlo')).toEqual({ add: ['ktlo'], remove: [] });
  });

  it('adds nothing when the item has the label in another case', () => {
    expect(labelChange(['KTLO'], group(), 'ktlo')).toEqual({ add: [], remove: [] });
    expect(labelChange(['ktlo'], group({ labels: { ktlo: 'KTLO', feature: 'feature' } }), 'ktlo').add).toEqual([]);
  });

  it("removes the scheme's other labels, spelled as the item spells them", () => {
    expect(labelChange(['Feature'], group(), 'ktlo')).toEqual({ add: ['ktlo'], remove: ['Feature'] });
  });

  it('never names a label outside the scheme', () => {
    const change = labelChange(['urgent', 'Feature', 'team-x'], group(), 'ktlo');
    expect(change.remove).toEqual(['Feature']);
    expect(change.add).toEqual(['ktlo']);
  });

  it('gives nothing for a category the group has no label for', () => {
    expect(labelChange(['Feature'], group(), 'spike')).toEqual({ add: [], remove: [] });
  });

  it('does not remove the label being added when two categories share its text', () => {
    const shared = group({ labels: { ktlo: 'work', feature: 'work', ops: 'ops' } });
    expect(labelChange(['work', 'OPS'], shared, 'ktlo')).toEqual({ add: [], remove: ['OPS'] });
  });

  it('keeps the wanted label and removes the other when the item carries both', () => {
    expect(labelChange(['ktlo', 'feature'], group(), 'ktlo')).toEqual({ add: [], remove: ['feature'] });
  });
});

describe('labelsAfter', () => {
  it("keeps the item's order, drops what remove names and puts add last", () => {
    expect(labelsAfter(['b', 'Feature', 'a'], { add: ['ktlo'], remove: ['Feature'] })).toEqual(['b', 'a', 'ktlo']);
  });

  it('returns the same labels for an empty change', () => {
    expect(labelsAfter(['b', 'a'], { add: [], remove: [] })).toEqual(['b', 'a']);
  });
});

describe('sameValue', () => {
  it('trims and ignores case', () => {
    expect(sameValue('  ktlo ', 'KTLO')).toBe(true);
    expect(sameValue('KTLO', ' ktlo  ')).toBe(true);
  });

  it('does not match a different value', () => {
    expect(sameValue('feature', 'ktlo')).toBe(false);
  });

  it('never matches null, undefined or an empty current value against a wanted one', () => {
    expect(sameValue(null, 'ktlo')).toBe(false);
    expect(sameValue(undefined, 'ktlo')).toBe(false);
    expect(sameValue('', 'ktlo')).toBe(false);
    expect(sameValue('   ', 'ktlo')).toBe(false);
  });
});

describe('fieldNotFound', () => {
  it('is NOT_FOUND and names the tracker as a person says it, and the field', () => {
    for (const [area, tracker] of [['jira', 'Jira'], ['github', 'GitHub'], ['ado', 'Azure DevOps']] as const) {
      const err = fieldNotFound(area, 'Work category');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toBe(`${tracker} has no field named "Work category".`);
    }
  });

  it('adds the where suffix when given', () => {
    expect(fieldNotFound('github', 'Category', 'in project corp/7').message).toBe('GitHub has no field named "Category" in project corp/7.');
  });

  it('has a fix that names how to set the field and how to drop it', () => {
    const fix = fieldNotFound('jira', 'Category').fix;
    expect(fix).toContain('toil projects classify set <toil-project> --target jira.field=<field>');
    expect(fix).toContain('toil projects classify set <toil-project> --clear jira');
  });
});

describe('optionMissing', () => {
  it('is INVALID_INPUT and lists the options the field has', () => {
    const err = optionMissing('jira', 'Category', 'KTLO', 'ktlo', ['Run', 'Change']);
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toBe('The field "Category" has no option "KTLO", the value for the category "ktlo". It has: Run, Change.');
  });

  it('says "no options" when there are none', () => {
    expect(optionMissing('ado', 'Category', 'KTLO', 'ktlo', []).message).toContain('It has: no options.');
  });

  it('has a fix that names the value mapping', () => {
    const fix = optionMissing('github', 'Category', 'KTLO', 'ktlo', []).fix;
    expect(fix).toContain('toil projects classify set <toil-project> --target github.value.ktlo=<option>');
    expect(fix).toContain('GitHub');
  });
});

describe('fieldNotOnType', () => {
  it('is undefined for an empty list', () => {
    expect(fieldNotOnType('Category', [])).toBeUndefined();
  });

  it('names each type with its count, singular for 1 item and plural otherwise', () => {
    const warning = fieldNotOnType('Category', [{ type: 'Epic', items: 1 }, { type: 'Task', items: 2 }]);
    expect(warning?.code).toBe('CATEGORIZE_FIELD_NOT_ON_TYPE');
    expect(warning?.message).toContain('The field "Category" isn\'t on Epic (1 item), Task (2 items)');
  });
});

describe('failureReason', () => {
  it('returns the message for an item-level HTTP, NOT_FOUND or 403 AUTH error', () => {
    expect(failureReason(new ToilError('HTTP', 'server said 500'))).toBe('server said 500');
    expect(failureReason(new ToilError('NOT_FOUND', 'gone'))).toBe('gone');
    expect(failureReason(new ToilError('AUTH', 'forbidden', { details: { status: 403 } }))).toBe('forbidden');
  });

  it.each([
    ['AUTH with 401', new ToilError('AUTH', 'bad token', { details: { status: 401 } })],
    ['AUTH with no details', new ToilError('AUTH', 'bad token')],
    ['NETWORK', new ToilError('NETWORK', 'down')],
    ['TIMEOUT', new ToilError('TIMEOUT', 'slow')],
    ['CANCELLED', new ToilError('CANCELLED', 'stopped')],
    ['INTERNAL', new ToilError('INTERNAL', 'oops')],
    ['a plain Error', new Error('not ours')],
  ])('rethrows the same error for %s', (_name, err) => {
    expect(thrown(() => failureReason(err))).toBe(err);
  });
});

describe('categorizeResult', () => {
  const change = { id: 'corp-jira:PAY-101', key: 'PAY-101', category: 'ktlo', labels: { added: ['ktlo'], removed: [] }, field: null };

  it('counts follow the lists and planned is the group item count', () => {
    const out = categorizeResult({
      connection: 'corp-jira',
      plan: plan(group()),
      group: group(),
      field: null,
      skipped: [],
      changed: [change],
      unchanged: ['PAY-102'],
      failed: [{ key: 'PAY-103', reason: 'nope' }],
    });
    expect(out.counts).toEqual({ planned: 2, changed: 1, unchanged: 1, failed: 1 });
    expect(out.changed).toEqual([change]);
    expect(out.unchanged).toEqual(['PAY-102']);
    expect(out.failed).toEqual([{ key: 'PAY-103', reason: 'nope' }]);
  });

  it("takes the plan's scheme and passes field and skipped through", () => {
    const field = { name: 'Category', id: 'customfield_10042' };
    const skipped = [{ area: 'github', connection: 'corp-gh', items: 3 }];
    const out = categorizeResult({ connection: 'corp-jira', plan: plan(group()), group: group(), field, skipped, changed: [], unchanged: [], failed: [] });
    expect(out.connection).toBe('corp-jira');
    expect(out.scheme).toEqual({ name: 'ktlo-feature', revision: 2 });
    expect(out.field).toBe(field);
    expect(out.skipped).toBe(skipped);
  });

  it('plans 0 when there is no group', () => {
    const out = categorizeResult({ connection: 'corp-jira', plan: plan(), group: undefined, field: null, skipped: [], changed: [], unchanged: [], failed: [] });
    expect(out.counts.planned).toBe(0);
  });
});

describe('categorizeWarnings', () => {
  it('has none for a clean result', () => {
    expect(categorizeWarnings(result())).toEqual([]);
  });

  it('says there is nothing to do when planned is 0', () => {
    expect(categorizeWarnings(result({ counts: { planned: 0, changed: 0, unchanged: 0, failed: 0 } }))).toEqual([NOTHING_TO_CATEGORIZE]);
  });

  it("names other connections' entries that were skipped", () => {
    const warnings = categorizeWarnings(result({ skipped: [{ area: 'github', connection: 'corp-gh', items: 1 }] }));
    expect(warnings.map((w) => w.code)).toEqual(['CATEGORIZE_SKIPPED']);
    expect(warnings[0]?.message).toContain('github "corp-gh" (1 item)');
  });

  it('names a single failure as key (reason), with the singular wording', () => {
    const warnings = categorizeWarnings(result({ counts: { planned: 1, changed: 0, unchanged: 0, failed: 1 }, failed: [{ key: 'PAY-101', reason: 'forbidden' }] }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('CATEGORIZE_FAILED');
    expect(warnings[0]?.message).toContain('1 of 1 item was not changed: PAY-101 (forbidden).');
    expect(warnings[0]?.message).not.toContain('more in data.failed');
  });

  it('names up to five failures and counts the rest', () => {
    const failed = Array.from({ length: 7 }, (_, i) => ({ key: `PAY-${101 + i}`, reason: `r${i}` }));
    const message = categorizeWarnings(result({ counts: { planned: 9, changed: 2, unchanged: 0, failed: 7 }, failed }))[0]?.message ?? '';
    expect(message).toContain('7 of 9 items were not changed: ');
    expect(message).toContain('PAY-101 (r0); PAY-102 (r1); PAY-103 (r2); PAY-104 (r3); PAY-105 (r4); and 2 more in data.failed.');
    expect(message).not.toContain('PAY-106');
  });

  it('names exactly five failures without a "more" clause', () => {
    const failed = Array.from({ length: 5 }, (_, i) => ({ key: `PAY-${101 + i}`, reason: 'x' }));
    const message = categorizeWarnings(result({ counts: { planned: 5, changed: 0, unchanged: 0, failed: 5 }, failed }))[0]?.message ?? '';
    expect(message).toContain('PAY-105 (x).');
    expect(message).not.toContain('more in data.failed');
  });

  it('lists the warnings in order: nothing, skipped, failed', () => {
    const warnings = categorizeWarnings(
      result({
        counts: { planned: 0, changed: 0, unchanged: 0, failed: 1 },
        skipped: [{ area: 'ado', connection: 'corp-ado', items: 2 }],
        failed: [{ key: 'PAY-101', reason: 'x' }],
      }),
    );
    expect(warnings.map((w) => w.code)).toEqual(['CATEGORIZE_NOTHING', 'CATEGORIZE_SKIPPED', 'CATEGORIZE_FAILED']);
  });
});
