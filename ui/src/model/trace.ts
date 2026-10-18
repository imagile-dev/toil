/**
 * Traceability: each work item, the pull requests that mention it, their
 * builds, and the environments running them, with the gaps a reviewer would
 * ask about. Pure, like sprint.ts. A chain of custody, kept without a single
 * signed form.
 */

import type { ChangeRef, Deployment, WorkItem } from '../toil.ts';
import { latestBuild } from './sprint.ts';

export type Flag = 'failing-build' | 'done-without-change' | 'merged-not-done';

export interface Trace {
  item: WorkItem;
  changes: ChangeRef[];
  builds: ChangeRef[];
  /** The environments running a merged pull request that mentions the item. */
  deployedTo: Deployment[];
  flags: Flag[];
}

export function trace(items: WorkItem[], changes: ChangeRef[], deployments: Deployment[] = []): Trace[] {
  return items
    .filter((item) => item.type !== 'EPIC' && item.type !== 'OTHER')
    .map((item) => {
      const mine = changes.filter((c) => c.items.includes(item.id));
      const code = mine.filter((c) => c.kind === 'pull-request');
      const builds = mine.filter((c) => c.kind === 'build');
      const flags: Flag[] = [];
      const done = item.statusCategory === 'DONE';
      if (!done && latestBuild(item.id, changes)?.outcome === 'failed') flags.push('failing-build');
      if (done && code.length === 0) flags.push('done-without-change');
      if (!done && code.length > 0 && code.every((c) => c.outcome === 'merged')) flags.push('merged-not-done');
      return { item, changes: code, builds, deployedTo: deployments.filter((d) => d.items.includes(item.id)), flags };
    });
}

export const FLAG_TEXT: Record<Flag, string> = {
  'failing-build': 'Latest build failed',
  'done-without-change': 'Done with no linked change',
  'merged-not-done': 'All changes merged, item still open',
};
