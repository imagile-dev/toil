/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read envelopes' untyped JSON */
import { describe, expect, it } from 'vitest';
import { runCli } from '../../test/harness/cli.js';
import { testContext } from '../../test/harness/context.js';
import { readBriefRecords } from '../core/brief/read.js';
import { sampleTeam } from '../core/sample/team.js';
import { sampleCommands } from './commands.js';

/**
 * `toil sample team` through the real CLI: what it prints, what it writes, and
 * that its envelope is a thing the briefing's reader will take, which is the
 * whole point of the pipe. A command that prints sample data nothing can read
 * is a screensaver.
 */

const AS_OF = '2026-11-10T08:00:00Z';
const run = async (argv: string[], files: Record<string, string> = {}) => {
  const { context, files: fs } = testContext({ files });
  const out = await runCli(['sample', 'team', ...argv], { commands: sampleCommands(), context });
  return { envelope: out.envelope as any, written: fs.written };
};

describe('sample team', () => {
  it('prints the Open Work Items by default, what util owi map returns', async () => {
    const { envelope } = await run(['--as-of', AS_OF]);
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.command).toBe('sample team');
    expect(envelope.data).toEqual(JSON.parse(JSON.stringify(sampleTeam(AS_OF).owi)));
    expect(Object.keys(envelope.data)).toEqual(['owi', 'count', 'items', 'changes', 'histories', 'unmapped', 'skipped']);
  });

  it('prints each part', async () => {
    const team = sampleTeam(AS_OF);
    expect((await run(['--as-of', AS_OF, '--part', 'facts'])).envelope.data).toEqual(JSON.parse(JSON.stringify(team.facts)));
    expect((await run(['--as-of', AS_OF, '--part', 'toil-project'])).envelope.data.name).toBe('sample-team');
    expect((await run(['--as-of', AS_OF, '--part', 'jira'])).envelope.data.total).toBe(team.facts.items);
    expect((await run(['--as-of', AS_OF, '--part', 'prs'])).envelope.data).toHaveLength(16);
  });

  it('is a stream the briefing and classify readers take as it is', async () => {
    const { envelope } = await run(['--as-of', AS_OF]);
    const records = readBriefRecords(JSON.stringify(envelope));
    expect(records.items).toHaveLength(envelope.data.items.length);
    expect(records.changes).toHaveLength(16);
    expect(records.skipped).toEqual([]);
  });

  it('refuses a day it cannot read, and --out with --part', async () => {
    expect((await run(['--as-of', 'next tuesday'])).envelope.error.code).toBe('INVALID_INPUT');
    expect((await run(['--out', 'sample', '--part', 'facts'])).envelope.error.fix).toContain('--part');
  });

  it('writes both files into a new folder and returns their paths and the facts', async () => {
    const { envelope, written } = await run(['--as-of', AS_OF, '--out', 'sample']);
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
    expect(envelope.data.owi).toMatch(/\/sample\/sample-team\.owi\.json$/);
    expect(envelope.data.toilProject).toMatch(/\/sample\/sample-team\.project\.json$/);
    expect(envelope.data.facts.items).toBeGreaterThan(130);
    expect(Object.keys(written).sort()).toHaveLength(2);
    const file = new TextDecoder().decode(Object.entries(written).find(([path]) => path.endsWith('owi.json'))![1]);
    expect(JSON.parse(file).items.length).toBe(envelope.data.facts.items);
    expect(file.endsWith('\n')).toBe(true);
  });

  it('writes neither file when either is there', async () => {
    const { envelope, written } = await run(['--as-of', AS_OF, '--out', 'sample'], { 'sample/sample-team.project.json': '{}' });
    expect(envelope.error.code).toBe('INVALID_INPUT');
    expect(envelope.error.message).toContain('Nothing was written');
    expect(Object.keys(written)).toEqual([]);
  });
});
