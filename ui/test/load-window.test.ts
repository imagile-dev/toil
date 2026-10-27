// @vitest-environment node
import { mapOwi } from '@imagile-dev/toil/api';
import { describe, expect, it } from 'vitest';
import { andWhere as adoAndWhere } from '../../src/areas/ado/wiql.ts';
import { andWhere as adoCloudAndWhere } from '../../src/areas/ado-cloud/wiql.ts';
import { withUpdatedSince } from '../../src/areas/jira/since.ts';
import { DEFAULT_RETENTION_DAYS } from '../server/settings.ts';
import { sqliteStore } from '../server/store.ts';
import { fixtureExecute } from '../src/fixtures/execute.ts';
import { DEFAULT_WINDOW_DAYS, JQL, PER_ITEM_CONCURRENCY, WIQL, isDashboardQuery, limiter, loadDossier, wiqlFor } from '../src/load.ts';
import type { Envelope, Execute } from '../src/toil.ts';

/**
 * The window the loader reads Jira and Azure DevOps through (#493), how the
 * incremental `updatedSince` composes with it, and the pool the per-item calls
 * run in.
 */

describe('the window', () => {
  it('is the cache default unless the sync says otherwise', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(DEFAULT_RETENTION_DAYS);
    expect(JQL('PAY')).toBe('project = PAY AND (statusCategory != Done OR updated >= -30d) ORDER BY Rank ASC');
    expect(JQL('PAY', 7)).toBe('project = PAY AND (statusCategory != Done OR updated >= -7d) ORDER BY Rank ASC');
    expect(WIQL).toBe(wiqlFor(30));
    expect(wiqlFor(7)).toBe("SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ([Microsoft.VSTS.Common.ClosedDate] = '' OR [System.ChangedDate] >= @Today - 7) ORDER BY [System.Id]");
  });

  it('composes with toil\'s updatedSince: Jira wraps the whole query, ahead of the ORDER BY', () => {
    expect(withUpdatedSince(JQL('PAY', 30), '2026-10-13 07:55')).toBe('(project = PAY AND (statusCategory != Done OR updated >= -30d)) AND updated >= "2026-10-13 07:55" ORDER BY Rank ASC');
  });

  it("composes with toil's updatedSince: Azure DevOps wraps the WHERE and keeps the ORDER BY, on Server and Services", () => {
    const since = "[System.ChangedDate] >= '2026-10-13T07:55:00.000Z'";
    const expected = `SELECT [System.Id] FROM WorkItems WHERE ([System.TeamProject] = @project AND ([Microsoft.VSTS.Common.ClosedDate] = '' OR [System.ChangedDate] >= @Today - 30)) AND ${since} ORDER BY [System.Id]`;
    expect(adoAndWhere(WIQL, since)).toBe(expected);
    expect(adoCloudAndWhere(WIQL, since)).toBe(expected);
  });

  it('is recognised as the dashboard\'s own query whatever its window, and nothing else is', () => {
    expect(isDashboardQuery({ jql: JQL('PAY', 7) })).toBe(true);
    expect(isDashboardQuery({ wiql: wiqlFor(90) })).toBe(true);
    expect(isDashboardQuery({ jql: 'project = PAY' })).toBe(false);
    expect(isDashboardQuery({ jql: 'project = PAY AND status = Blocked ORDER BY Rank ASC' })).toBe(false);
    expect(isDashboardQuery({ wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'" })).toBe(false);
    expect(isDashboardQuery({})).toBe(false);
  });

  it('is sent to the trackers as the sync asks for it', async () => {
    const seen: Array<{ command: string; input: Record<string, unknown> }> = [];
    const fixture = fixtureExecute();
    // The fixture answers the default window; this records what the loader asked, then asks the fixture the default.
    const execute: Execute = (command, input = {}, options) => {
      seen.push({ command, input });
      return fixture.execute(command, { ...input, ...(typeof input.jql === 'string' ? { jql: JQL('PAY') } : {}), ...(typeof input.wiql === 'string' ? { wiql: WIQL } : {}) }, options);
    };
    await loadDossier(execute, 'card-payments', { mapOwi, windowDays: 7 });
    await loadDossier(execute, 'settlement', { mapOwi, windowDays: 7 });
    expect(seen.find((c) => c.command === 'jira issue search')!.input.jql).toBe(JQL('PAY', 7));
    expect(seen.find((c) => c.command === 'ado work-item search')!.input.wiql).toBe(wiqlFor(7));
  });
});

describe('the cache answers the dashboard whatever window the sync used', () => {
  it('finds the stored search for the same query with another window, and not for any other', async () => {
    const stored = { ok: true, data: { issues: [{ key: 'PAY-1' }] }, error: null, meta: { command: 'jira issue search', durationMs: 0, version: 'x', contractVersion: 1 } } as Envelope;
    const cache = {
      response: (_d: string, _c: string, input: Record<string, unknown>) => (input.jql === JQL('PAY', 7) ? { envelope: stored, area: 'jira', syncedAt: 't' } : null),
      latest: () => ({ envelope: stored, area: 'jira', syncedAt: 't' }),
      source: () => null,
    };
    const store = sqliteStore(() => cache as never, (async () => stored) as unknown as Execute, { version: 'x', contractVersion: 1 });
    const ctx = { viewer: { id: 'local', name: 'you', via: 'launch-token' }, signal: new AbortController().signal } as never;
    expect((await store.execute(ctx, 'jira issue search', { dossier: 'd', jql: JQL('PAY') }, 'read')).ok).toBe(true);
    expect((await store.execute(ctx, 'jira issue search', { dossier: 'd', jql: 'project = PAY AND status = Blocked' }, 'read')).ok).toBe(false);
  });
});

describe('the per-item pool', () => {
  it('never runs more than the limit at once, and starts the next as one finishes', async () => {
    const slot = limiter(3);
    let active = 0;
    let most = 0;
    const done: number[] = [];
    await Promise.all(
      Array.from({ length: 20 }, (_, n) =>
        slot(async () => {
          active++;
          most = Math.max(most, active);
          await new Promise((r) => setTimeout(r, (n * 7) % 5));
          active--;
          done.push(n);
        }),
      ),
    );
    expect(most).toBe(3);
    expect(done).toHaveLength(20);
  });

  it('keeps a failing call from holding its place', async () => {
    const slot = limiter(1);
    const results = await Promise.allSettled([slot(async () => Promise.reject(new Error('no'))), slot(async () => 'next')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled']);
  });

  it('loads a dossier the same whatever order the calls finish in, with the calls in the order of the ids', async () => {
    const fixture = fixtureExecute();
    const plain = await loadDossier(fixture.execute, 'card-payments', { mapOwi });

    let active = 0;
    let most = 0;
    let n = 0;
    const slow: Execute = async (command, input, options) => {
      const mine = n++;
      active++;
      most = Math.max(most, active);
      // Histories finish in a different order from the one they were sent in.
      if (command.endsWith(' history') || command.endsWith(' pr get')) await new Promise((r) => setTimeout(r, (mine * 13) % 7));
      const out = await fixtureExecute().execute(command, input, options);
      active--;
      return out;
    };
    const pooled = await loadDossier(slow, 'card-payments', { mapOwi });
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(PER_ITEM_CONCURRENCY);
    expect(pooled.items).toEqual(plain.items);
    expect(pooled.changes).toEqual(plain.changes);
    expect(pooled.calls.work).toEqual(plain.calls.work);
    expect(pooled.calls.prs).toEqual(plain.calls.prs);
  });
});
