/**
 * Traceability: each work item, the changes that mention it, and the builds
 * of those changes, with the gaps a reviewer would ask about. Pure, like
 * sprint.ts. A chain of custody, kept without a single signed form.
 */

import type { ChangeRef, WorkItem } from '../store.ts';
import { latestBuild } from './sprint.ts';

export type Flag = 'failing-build' | 'done-without-change' | 'merged-not-done';

export interface Trace {
  item: WorkItem;
  changes: ChangeRef[];
  builds: ChangeRef[];
  flags: Flag[];
}

export function trace(items: WorkItem[], changes: ChangeRef[]): Trace[] {
  return items
    .filter((item) => item.type !== 'EPIC' && item.type !== 'OTHER')
    .map((item) => {
      const mine = changes.filter((c) => c.items.includes(item.id));
      const code = mine.filter((c) => c.kind !== 'build');
      const builds = mine.filter((c) => c.kind === 'build');
      const flags: Flag[] = [];
      const done = item.statusCategory === 'DONE';
      if (!done && latestBuild(item.id, changes)?.outcome === 'failed') flags.push('failing-build');
      if (done && code.length === 0) flags.push('done-without-change');
      if (!done && code.length > 0 && code.every((c) => c.outcome === 'merged')) flags.push('merged-not-done');
      return { item, changes: code, builds, flags };
    });
}

export const FLAG_TEXT: Record<Flag, string> = {
  'failing-build': 'Latest build failed',
  'done-without-change': 'Done with no linked change',
  'merged-not-done': 'All changes merged, item still open',
};
