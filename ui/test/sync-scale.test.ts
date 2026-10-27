// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { simulate, type Counts } from './scale-sim.ts';

/**
 * A large project, simulated (#493, test/scale-sim.ts): 3000 issues of which
 * 200 are open or touched within the week, and the rest closed 60 days to four
 * years ago. The first sync reads the window, not the project; a second one that
 * finds nothing sends only its delta queries and rewrites next to nothing.
 */

const TOTAL = 3000;
const LIVE = 200;
const report = (label: string, c: Counts) => console.info(`[scale] ${label}: ${c.toilCalls} toil calls, ${c.requests} requests, ${c.rowsWritten} rows written, ${c.items} items, ${c.seconds.toFixed(1)}s, tracker ${JSON.stringify(c.tracker)}`);

describe('a large Jira project', () => {
  it('syncs its window, then nothing, then the day after a deletion', async () => {
    const sim = await simulate('jira', TOTAL, LIVE);
    try {
      const first = await sim.sync(0);
      report('jira first sync', first);
      // The window: the 200 live issues, one history call each, and the paged search to list them.
      expect(first.items).toBe(LIVE);
      expect(first.tracker['jira issue history']).toBe(LIVE);
      expect(first.tracker['jira issue search']).toBe(Math.ceil(LIVE / 100));

      const second = await sim.sync(3_600_000);
      report('jira second sync, nothing changed', second);
      expect(second.tracker['jira issue history'] ?? 0).toBe(0);
      expect(second.tracker['jira issue search']).toBe(1);
      expect(second.items).toBe(LIVE);
      // The dossier's row, the sources' rows, the sync runs, and the sample dossier's few pull requests: nothing proportional to the 200 issues.
      expect(second.rowsWritten).toBeLessThan(40);

      sim.touch(TOTAL);
      sim.remove(TOTAL - 1);
      const third = await sim.sync(3_600_000);
      report('jira third sync, one changed', third);
      expect(third.tracker['jira issue history']).toBe(1);
      expect(third.items).toBe(LIVE);
      expect(third.rowsWritten).toBeLessThan(80);

      const fourth = await sim.sync(25 * 3_600_000);
      report('jira fourth sync, a day on, reconciling', fourth);
      expect(fourth.items).toBe(LIVE - 1);
      expect(fourth.tracker['jira issue history'] ?? 0).toBe(0);
    } finally {
      sim.close();
    }
  }, 120_000);
});

describe('a large Azure DevOps project', () => {
  it('syncs its window, then nothing', async () => {
    const sim = await simulate('ado', TOTAL, LIVE);
    try {
      const first = await sim.sync(0);
      report('ado first sync', first);
      expect(first.items).toBe(LIVE);
      expect(first.tracker['ado work-item history']).toBe(LIVE);

      const second = await sim.sync(3_600_000);
      report('ado second sync, nothing changed', second);
      expect(second.tracker['ado work-item history'] ?? 0).toBe(0);
      expect(second.tracker['ado work-item get-many'] ?? 0).toBe(0);
      expect(second.rowsWritten).toBeLessThan(40);
    } finally {
      sim.close();
    }
  }, 120_000);

});
