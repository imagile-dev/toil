/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read envelopes' untyped JSON */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedConfig } from '../core/config.js';
import type { Envelope } from '../core/envelope.js';
import { standardsProjectCommands } from '../projects/standards-set.js';
import { areas } from '../registry.js';
import { runCli } from '../../test/harness/cli.js';
import { testContext } from '../../test/harness/context.js';
import { connectMcp, type McpSession } from '../../test/harness/mcp.js';
import { toilProjectDisk, type ToilProjectDisk } from '../../test/harness/toil-projects.js';
import { EXAMPLE_STANDARD, standardsCommands } from './commands.js';

const commands = [...standardsCommands(), ...standardsProjectCommands()];
const toilProjectAreas = areas.map((a) => ({ name: a.name, context: Object.keys(a.context) }));
const config: ResolvedConfig = { connections: {}, defaults: {}, sources: {}, files: { global: '/home/test/.toil/config.json' }, warnings: [] };

const RISK_RULES = { name: 'risk', rules: [{ id: 'risk', name: 'Risk filled in', text: 'The Risk field says how risky the change is.' }] };

const disks: ToilProjectDisk[] = [];
const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  disks.splice(0).forEach((d) => d.cleanup());
});

function disk(extra: Record<string, unknown> = {}): ToilProjectDisk {
  const d = toilProjectDisk({
    'home/.toil/projects/payments.json': { name: 'payments', jira: { fields: { risk: 'customfield_10777' } }, standards: { use: ['gherkin', './rules/risk.json'] } },
    // In a folder below, so the toil project scan doesn't read it as a toil project.
    'home/.toil/projects/rules/risk.json': RISK_RULES,
    'home/.toil/projects/bare.json': { name: 'bare' },
    'work/.git/HEAD': 'ref: refs/heads/main\n',
    'work/.toil/standards/team.json': { name: 'team', description: 'Checked in.', rules: [{ id: 'title', name: 'Title', text: 'The title says what changes.' }] },
    ...extra,
  });
  disks.push(d);
  return d;
}

function contextFor(d: ToilProjectDisk, files: Record<string, string>, mcp = false) {
  const { context } = testContext({ files });
  return { ...context, config, standards: d.standards(config, mcp ? { mcp: true } : {}), toilProjects: d.catalog(config, { areas: toilProjectAreas, ...(mcp ? { mcp: true } : {}) }) };
}
async function cli(d: ToilProjectDisk, argv: string[], files: Record<string, string> = { 'team-stories.json': EXAMPLE_STANDARD }): Promise<Envelope> {
  return (await runCli(argv, { commands, context: contextFor(d, files) })).envelope!;
}
async function mcp(d: ToilProjectDisk, files: Record<string, string> = { 'team-stories.json': EXAMPLE_STANDARD }): Promise<McpSession> {
  const session = await connectMcp({ commands, context: contextFor(d, files, true), areas: ['standards', 'projects'] });
  sessions.push(session);
  return session;
}
const data = (e: Envelope) => {
  expect(e.ok, JSON.stringify(e.error)).toBe(true);
  return e.data as Record<string, any>;
};
const codes = (e: Envelope) => (e.meta.warnings ?? []).map((w) => w.code);

describe('standards list', () => {
  it("lists the repository's standards and the built-ins, each with its rules' plain text", async () => {
    const d = disk();
    const out = data(await cli(d, ['standards', 'list']));
    expect(out.toilProject).toBeNull();
    expect(out.standards.map((s: any) => [s.name, s.source])).toEqual([['team', 'repo'], ['gherkin', 'built-in'], ['user-story', 'built-in'], ['bug-repro', 'built-in']]);
    expect(out.standards[0]).toMatchObject({ description: 'Checked in.', file: expect.stringMatching(/work\/\.toil\/standards\/team\.json$/), rules: [{ id: 'title', name: 'Title', text: 'The title says what changes.' }] });
    expect(out.standards[1].rules[0]).toEqual({ id: 'scenarios', name: 'Acceptance criteria as Given/When/Then', text: expect.stringContaining('This rule is for stories.') });
  });

  it("lists the standards a toil project names, in its order, a path beside it included", async () => {
    const out = data(await cli(disk(), ['standards', 'list', '--toil-project', 'payments']));
    expect(out.toilProject).toBe('payments');
    expect(out.standards.map((s: any) => [s.name, s.source])).toEqual([['gherkin', 'built-in'], ['risk', 'toil-project']]);
    const bare = await cli(disk(), ['standards', 'list', '--toil-project', 'bare']);
    expect(data(bare)).toEqual({ toilProject: 'bare', standards: [] });
    expect(codes(bare)).toEqual(['STANDARDS_NONE']);
    expect(bare.meta.warnings![0]!.message).toContain('toil projects standards set bare');
    expect(bare.meta.warnings![0]!.message).toContain("Toil UI's Settings");
  });

  it('is served over MCP with the same result', async () => {
    const d = disk();
    const session = await mcp(d);
    const over = (await session.call('standards_list', { toilProject: 'payments' })).envelope;
    expect(over.data).toEqual((await cli(d, ['standards', 'list', '--toil-project', 'payments'])).data);
  });
});

describe('standards save and remove', () => {
  const mineFile = (d: ToilProjectDisk, name: string) => JSON.parse(readFileSync(join(d.home, '.toil', 'standards', `${name}.json`), 'utf8')) as Record<string, any>;

  it('saves a new standard to your folder at revision 1, then raises the revision on each change', async () => {
    const d = disk();
    const first = data(await cli(d, ['standards', 'save', 'team-stories', '--input-file', 'team-stories.json']));
    expect(first).toMatchObject({ name: 'team-stories', revision: 1, previousRevision: null, file: expect.stringMatching(/home\/\.toil\/standards\/team-stories\.json$/) });
    expect(mineFile(d, 'team-stories')).toMatchObject({ name: 'team-stories', revision: 1, rules: [{ id: 'risk' }] });
    const changed = JSON.stringify({ ...JSON.parse(EXAMPLE_STANDARD), rules: [{ id: 'risk', name: 'Names its risk', text: 'Edited freely.\nOn two lines.' }] });
    const second = data(await cli(d, ['standards', 'save', 'team-stories', '--text', changed]));
    expect(second).toMatchObject({ revision: 2, previousRevision: 1 });
    expect(mineFile(d, 'team-stories').rules[0].text).toBe('Edited freely.\nOn two lines.');
    // The same content again writes nothing.
    const same = await cli(d, ['standards', 'save', 'team-stories', '--text', changed]);
    expect(data(same).revision).toBe(2);
    expect(codes(same)).toEqual(['STANDARD_UNCHANGED']);
  });

  it("saves a copy of a built-in under its name as yours, and refuses a name that disagrees or a file in the old shape", async () => {
    const d = disk();
    expect(data(await cli(d, ['standards', 'save', 'gherkin', '--text', EXAMPLE_STANDARD])).revision).toBe(1);
    expect(data(await cli(d, ['standards', 'list'])).standards.find((s: any) => s.name === 'gherkin').source).toBe('user');
    expect((await cli(d, ['standards', 'save', 'mine', '--text', JSON.stringify({ name: 'other', rules: [] })])).error).toMatchObject({ code: 'INVALID_INPUT' });
    const old = await cli(d, ['standards', 'save', 'mine', '--text', JSON.stringify({ rules: [{ id: 'a', name: 'A', text: 'B', check: { kind: 'words', in: ['title'], min: 3 } }] })]);
    expect(old.error).toMatchObject({ code: 'CONFIG_INVALID' });
    expect(old.error!.fix).toContain('remove check, when, fail and missing');
  });

  it('removes your own standard and says what the name means now', async () => {
    const d = disk();
    await cli(d, ['standards', 'save', 'gherkin', '--text', EXAMPLE_STANDARD]);
    const out = await cli(d, ['standards', 'remove', 'gherkin']);
    expect(data(out)).toMatchObject({ name: 'gherkin', now: 'built-in' });
    expect(codes(out)).toEqual(['STANDARD_NOW_FROM']);
    expect((await cli(d, ['standards', 'remove', 'team'])).error).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is never served over MCP: the rules an agent is judged by are a person\'s', async () => {
    const session = await mcp(disk());
    const tools = (await session.client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('standards_list');
    expect(tools).not.toContain('standards_save');
    expect(tools).not.toContain('standards_remove');
  });
});

describe('projects standards set', () => {
  const fileOf = (d: ToilProjectDisk, name: string) => JSON.parse(readFileSync(join(d.home, '.toil', 'projects', `${name}.json`), 'utf8')) as Record<string, any>;

  it('sets the list, and refuses to change one without --replace', async () => {
    const d = disk();
    const out = data(await cli(d, ['projects', 'standards', 'set', 'bare', '--use', 'gherkin', '--use', 'bug-repro']));
    expect(out).toMatchObject({ name: 'bare', changed: true, standards: { use: ['gherkin', 'bug-repro'] } });
    expect(fileOf(d, 'bare').standards).toEqual({ use: ['gherkin', 'bug-repro'] });
    const again = await cli(d, ['projects', 'standards', 'set', 'bare', '--use', 'user-story']);
    expect(again.error).toMatchObject({ code: 'INVALID_INPUT', fix: 'Pass --replace to replace the list.' });
    expect(data(await cli(d, ['projects', 'standards', 'set', 'bare', '--use', 'user-story', '--replace'])).standards).toEqual({ use: ['user-story'] });
    // The same list again changes nothing.
    expect(data(await cli(d, ['projects', 'standards', 'set', 'bare', '--use', 'user-story'])).changed).toBe(false);
  });

  it('warns about a standard it cannot read yet, and refuses a ref that is neither a name nor a relative file', async () => {
    const d = disk();
    const later = await cli(d, ['projects', 'standards', 'set', 'bare', '--use', './later.json']);
    expect(data(later).standards).toEqual({ use: ['./later.json'] });
    expect(codes(later)).toEqual(['STANDARD_UNRESOLVED']);
    expect((await cli(d, ['projects', 'standards', 'set', 'bare', '--use', '/abs/rules.json', '--replace'])).error).toMatchObject({ code: 'INVALID_INPUT' });
    expect((await cli(d, ['projects', 'standards', 'set', 'bare', '--use', 'Team Rules', '--replace'])).error).toMatchObject({ code: 'INVALID_INPUT' });
    expect((await cli(d, ['projects', 'standards', 'set', 'bare'])).error).toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('clears the key on the CLI, and is never served over MCP, so an agent neither chooses nor clears the rules (#657)', async () => {
    const d = disk();
    expect(data(await cli(d, ['projects', 'standards', 'set', 'payments', '--clear'])).standards).toBeNull();
    expect(fileOf(d, 'payments')).not.toHaveProperty('standards');
    const session = await mcp(disk());
    expect((await session.client.listTools()).tools.map((t) => t.name)).not.toContain('projects_standards_set');
  });
});
