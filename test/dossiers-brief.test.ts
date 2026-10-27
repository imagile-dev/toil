import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnyCommand } from '../src/core/command.js';
import type { ResolvedConfig } from '../src/core/config.js';
import type { Envelope } from '../src/core/envelope.js';
import { dossierBriefCommands, EXAMPLE_BRIEF_RECORDS } from '../src/dossiers/brief.js';
import { dossierBuildCommands } from '../src/dossiers/build.js';
import { ANALYZE_PROMPT } from '../src/mcp/server.js';
import { areas } from '../src/registry.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { dossierDisk, type DossierDisk } from './harness/dossiers.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/**
 * `toil dossiers brief` and `toil dossiers analyze set | show | prompt` (#494),
 * end to end on real dossier files, through the CLI and over MCP: the
 * briefing's warnings and refusals, a dossier's Analyze settings written,
 * read back and applied to the briefing, the focus labelled with where it
 * came from, and the Analyze prompt `toil mcp` serves.
 */

const dossierAreas = areas.map((a) => ({ name: a.name, context: Object.keys(a.context) }));
const commands: AnyCommand[] = [...dossierBriefCommands(), ...dossierBuildCommands(areas)];
const config: ResolvedConfig = { connections: {}, defaults: {}, sources: {}, files: { global: '/home/test/.toil/config.json' }, warnings: [] };
const AS_OF = '2026-10-13T08:00:00Z';

const disks: DossierDisk[] = [];
const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  disks.splice(0).forEach((d) => d.cleanup());
});

function disk(): DossierDisk {
  const d = dossierDisk({
    'home/.toil/dossiers/payments.json': { name: 'payments', wipLimit: 2 },
    'work/.git/HEAD': 'ref: refs/heads/main\n',
    'work/.toil/dossiers/team.json': { name: 'team', analyze: { goal: 'Ship card payments v2.', leaveOut: 'The docs epic.' } },
  });
  disks.push(d);
  return d;
}

async function cli(d: DossierDisk, argv: string[]): Promise<Envelope> {
  const { context } = testContext({ files: { 'brief.json': EXAMPLE_BRIEF_RECORDS } });
  const run = await runCli(argv, { commands, context: { ...context, config, dossiers: d.catalog(config, { areas: dossierAreas }) } });
  return run.envelope!;
}
const data = <T>(e: Envelope) => {
  expect(e.error).toBeNull();
  return e.data as T;
};

describe('toil dossiers brief', () => {
  it('briefs from a file, and says what it read the dossier as', async () => {
    const b = data<{ dossier: unknown; recommendation: { text: string }; reasons: Array<{ lens: string }> }>(await cli(disk(), ['dossiers', 'brief', 'payments', '--file', 'brief.json', '--as-of', '2026-10-14T08:00:00Z']));
    expect(b.dossier).toMatchObject({ name: 'payments', source: 'user', adopted: true });
    expect(b.recommendation.text).toBe('Fix the failing checks on [[corp-jira:PAY-101]] first: it holds up 1 item (3 points).');
    expect(b.reasons.map((r) => r.lens)).toEqual(['failing', 'blocked']);
  });

  it('warns about pull requests that name no item in the input', async () => {
    const records = JSON.parse(EXAMPLE_BRIEF_RECORDS) as { items: unknown[]; changes: Array<Record<string, unknown>> };
    records.changes[0]!.workItems = ['corp-jira:PAY-999'];
    const e = await cli(disk(), ['dossiers', 'brief', 'payments', '--text', JSON.stringify(records), '--as-of', AS_OF]);
    expect(e.meta.warnings).toEqual([expect.objectContaining({ code: 'BRIEF_UNLINKED_CHANGES' })]);
  });

  it('refuses input with no work items, and says how to make some', async () => {
    const e = await cli(disk(), ['dossiers', 'brief', 'payments', '--text', JSON.stringify({ changes: [] })]);
    expect(e.error).toMatchObject({ code: 'INVALID_INPUT', message: 'The input holds no work items.', fix: expect.stringContaining('toil util owi map') });
  });
});

describe('toil dossiers analyze', () => {
  it('writes a dossier\'s settings, reads them back, and the briefing follows them', async () => {
    const d = disk();
    data(await cli(d, ['dossiers', 'analyze', 'set', 'payments', '--goal', 'Card payments v2 by 31 Oct.', '--order', 'blocked,failing', '--off', 'stale', '--threshold', 'failing=48']));
    const file = JSON.parse(readFileSync(join(d.home, '.toil', 'dossiers', 'payments.json'), 'utf8')) as Record<string, unknown>;
    expect(file.analyze).toEqual({ goal: 'Card payments v2 by 31 Oct.', lenses: [{ id: 'blocked' }, { id: 'failing', threshold: 48 }, { id: 'stale', on: false }] });

    const shown = data<{ standard: boolean; lenses: Array<{ id: string; on: boolean; threshold: number | null }> }>(await cli(d, ['dossiers', 'analyze', 'show', 'payments']));
    expect(shown.standard).toBe(false);
    expect(shown.lenses.slice(0, 3).map((l) => [l.id, l.on, l.threshold])).toEqual([['blocked', true, null], ['failing', true, 48], ['stale', false, 5]]);
    expect(shown.lenses.map((l) => l.id)).toEqual(['blocked', 'failing', 'stale', 'waiting', 'sprint', 'load', 'drift', 'ready']);

    const b = data<{ reasons: Array<{ lens: string }> }>(await cli(d, ['dossiers', 'brief', 'payments', '--file', 'brief.json', '--as-of', '2026-10-14T08:00:00Z']));
    expect(b.reasons.map((r) => r.lens)).toEqual(['blocked']);
  });

  it('refuses to change a setting already there without --replace, and to name a lens that does not exist', async () => {
    const d = disk();
    data(await cli(d, ['dossiers', 'analyze', 'set', 'payments', '--goal', 'One.']));
    expect((await cli(d, ['dossiers', 'analyze', 'set', 'payments', '--goal', 'Two.'])).error).toMatchObject({ code: 'INVALID_INPUT', fix: 'Pass --replace to change it.' });
    expect(data<{ analyze: { goal: string } }>(await cli(d, ['dossiers', 'analyze', 'set', 'payments', '--goal', 'Two.', '--replace'])).analyze.goal).toBe('Two.');
    expect((await cli(d, ['dossiers', 'analyze', 'set', 'payments', '--off', 'vibes'])).error).toMatchObject({ code: 'INVALID_INPUT', message: '--off names "vibes", which isn\'t a lens.' });
  });

  it('puts the focus in the prompt, labelled with where it came from', async () => {
    const d = disk();
    const mine = data<{ prompt: string; focused: boolean }>(await cli(d, ['dossiers', 'analyze', 'prompt', 'payments']));
    expect(mine.focused).toBe(false);
    expect(mine.prompt).toContain('dossiers_brief with dossier "payments"');
    expect(mine.prompt).not.toContain('The focus below');

    const theirs = data<{ prompt: string; dossier: { adopted: boolean; repo: string } }>(await cli(d, ['dossiers', 'analyze', 'prompt', 'team', '--cwd', d.workspace]));
    expect(theirs.dossier).toMatchObject({ adopted: false, repo: d.workspace.replaceAll('\\', '/') });
    expect(theirs.prompt).toContain(`The focus below comes from the dossier "team", checked in at ${d.workspace.replaceAll('\\', '/')}, which the reader has not adopted.`);
    expect(theirs.prompt).toContain('List every item you leave out because of "Leave out"');

    const ui = data<{ prompt: string }>(await cli(d, ['dossiers', 'analyze', 'prompt', 'team', '--cwd', d.workspace, '--host', 'toil-ui']));
    expect(ui.prompt).toContain('```briefing');
  });

  it('serves the Analyze prompt over MCP, built by the same command', async () => {
    const d = disk();
    const { context } = testContext({});
    const session = await connectMcp({ commands, context: { ...context, config, dossiers: d.catalog(config, { areas: dossierAreas, mcp: true }) }, areas: ['dossiers'] });
    sessions.push(session);
    expect((await session.client.listPrompts()).prompts).toEqual([ANALYZE_PROMPT]);
    const got = await session.client.getPrompt({ name: 'analyze', arguments: { dossier: 'payments' } });
    expect(got.description).toBe('Analyze the dossier payments');
    const message = got.messages[0]!.content as { type: string; text: string };
    expect(message.text).toContain('Analyze the dossier "payments"');
    await expect(session.client.getPrompt({ name: 'analyze', arguments: { dossier: 'nope' } })).rejects.toThrow(/nope/);
  });

  it('keeps clearing a setting off MCP, where it is a delete', async () => {
    const d = disk();
    const { context } = testContext({});
    const session = await connectMcp({ commands, context: { ...context, config, dossiers: d.catalog(config, { areas: dossierAreas, mcp: true }) }, areas: ['dossiers'] });
    sessions.push(session);
    const cleared = await session.call('dossiers_analyze_set', { dossier: 'payments', reset: true });
    expect(cleared.envelope.error?.message).toContain('never served over MCP');
  });
});
