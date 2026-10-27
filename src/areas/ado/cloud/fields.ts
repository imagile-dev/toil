import { ToilError } from '../../../core/errors.js';

/**
 * Work item fields as a caller names them: `--field name=value`, resolved
 * through the connection's `fieldAliases`, then a short built-in list, then
 * sent as the reference name it already is. Each field has a friendly name,
 * a reference name and a display name, so at least one is always right.
 */

export interface JsonPatchOp {
  op: 'add' | 'replace' | 'remove' | 'test';
  path: string;
  value?: unknown;
}

/** Friendly name to reference name for the most common fields, under the connection's own `fieldAliases`. The same list `ado` applies. */
const BUILT_IN: Record<string, string> = {
  title: 'System.Title',
  state: 'System.State',
  assignedto: 'System.AssignedTo',
  description: 'System.Description',
  areapath: 'System.AreaPath',
  iterationpath: 'System.IterationPath',
  iteration: 'System.IterationPath',
  tags: 'System.Tags',
  priority: 'Microsoft.VSTS.Common.Priority',
  severity: 'Microsoft.VSTS.Common.Severity',
  effort: 'Microsoft.VSTS.Scheduling.Effort',
  storypoints: 'Microsoft.VSTS.Scheduling.StoryPoints',
  remainingwork: 'Microsoft.VSTS.Scheduling.RemainingWork',
  remaining: 'Microsoft.VSTS.Scheduling.RemainingWork',
  acceptancecriteria: 'Microsoft.VSTS.Common.AcceptanceCriteria',
  reprosteps: 'Microsoft.VSTS.TCM.ReproSteps',
};

const squash = (s: string): string => s.toLowerCase().replace(/[\s-]+/g, '');

/** `--field name=value` arguments as a record, split on the first `=`. A missing `=`, or one at the start, is refused. */
export function parseFieldArgs(fields: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const f of fields) {
    const eq = f.indexOf('=');
    if (eq <= 0) throw new ToilError('INVALID_INPUT', `Invalid --field value "${f}". Expected format: name=value`, { fix: 'Pass each field as name=value, e.g. --field "Story Points=5" or --field Microsoft.VSTS.Scheduling.StoryPoints=5.' });
    result[f.slice(0, eq)] = f.slice(eq + 1);
  }
  return result;
}

/** A field name as its reference name: the connection's aliases, then the built-in ones, matched ignoring case, spaces and dashes; anything else as given. */
export function referenceName(name: string, fieldAliases: Record<string, string> = {}): string {
  const own = Object.entries(fieldAliases).find(([alias]) => squash(alias) === squash(name))?.[1];
  return own ?? BUILT_IN[squash(name)] ?? name;
}

/** JSON Patch `add` operations for a field record, in the order given. */
export function fieldPatch(fields: Record<string, unknown>, fieldAliases: Record<string, string> = {}): JsonPatchOp[] {
  return Object.entries(fields).map(([name, value]) => ({ op: 'add' as const, path: `/fields/${referenceName(name, fieldAliases)}`, value }));
}
