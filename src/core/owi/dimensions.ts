import { pathKey } from './ado.js';
import { OWI_SOURCES } from './types.js';
import type { Ancestor, Iteration, WorkItem } from './types.js';

/**
 * The two dimensions OWI works out from the whole input rather than from one
 * record: `ancestors`, the parent chain among the items mapped together, and
 * `sprints` for the sources that list a sprint only in a history (Azure
 * DevOps, GitHub). Each is computed after every item exists, since a chain
 * needs its parents and a history is attached late. Both stay absent when
 * their source wasn't read, and a chain that runs out of input simply ends,
 * as most org charts do at the first director who isn't in the spreadsheet.
 */

/** The most levels one chain is followed for: no real tree is deeper, and a corrupt one mustn't loop the mapper. */
export const MAX_ANCESTORS = 50;

/**
 * Sets `ancestors` on every item whose parent was read: its parent, that
 * parent's parent and so on, nearest first, from the items in `items`. The
 * chain ends at an item with no parent, at a parent that isn't in the input,
 * or where it would revisit an item (a cycle, which Jira and Azure DevOps
 * both refuse to create but a record can still hold). An item whose parent
 * wasn't read has no `ancestors` key; one with no parent has `[]`.
 */
export function setAncestors(items: Map<string, WorkItem>, parentRead: ReadonlySet<string>): void {
  for (const item of items.values()) {
    if (!parentRead.has(item.id)) continue;
    const chain: Ancestor[] = [];
    const seen = new Set<string>([item.id]);
    let next = item.parent;
    while (next !== null && !seen.has(next) && chain.length < MAX_ANCESTORS) {
      const parent = items.get(next);
      if (!parent) break;
      seen.add(next);
      chain.push({ id: parent.id, type: parent.type, typeName: parent.typeName, title: parent.title });
      next = parent.parent;
    }
    item.ancestors = chain;
  }
}

/**
 * Sets `sprints` for an item that has a history, from the iterations the
 * history says it was in: the one it started in, then each it moved to, each
 * once, in order, then the current iteration if the history never named it
 * (an item that sat in one sprint all its life has no iteration change).
 * The current iteration is used where it matches, so it keeps its dates and id; an Azure DevOps path takes its dates from the iteration
 * tree when the input held one. An item with no history has no `sprints`.
 */
export function setSprintsFromHistory(item: WorkItem, dates: Map<string, { id: string | null; start: string | null; end: string | null }> | undefined): void {
  if (item.history === null || item.sprints !== undefined) return;
  // An Azure DevOps path with no `\` is the project's root node, which is where an item sits when it is in no sprint, so it is not one.
  const ado = OWI_SOURCES[item.source.area]?.family === 'ado';
  const names: string[] = [];
  const add = (name: string) => {
    if (ado && !name.includes('\\')) return;
    if (!names.includes(name)) names.push(name);
  };
  for (const change of item.history.iterations) for (const name of [...change.from, ...change.to]) add(name);
  const now = item.iteration;
  if (now && !names.includes(now.name) && !(now.path && names.includes(now.path))) add(now.path ?? now.name);
  const sprints: Iteration[] = names.map((name) => {
    if (now && (now.name === name || now.path === name)) return { ...now };
    const known = dates?.get(pathKey(name, false));
    return { id: known?.id ?? null, name: name.split('\\').pop()!, path: name.includes('\\') ? name : null, start: known?.start ?? null, end: known?.end ?? null, state: null };
  });
  item.sprints = sprints;
}
