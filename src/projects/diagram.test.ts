/* eslint-disable @typescript-eslint/no-explicit-any -- the tests read envelopes' untyped JSON */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BOOKSHOP_C4 } from '../../test/fixtures/util.fixture.js';
import { runCli } from '../../test/harness/cli.js';
import { testContext } from '../../test/harness/context.js';
import { connectMcp, type McpSession } from '../../test/harness/mcp.js';
import { toilProjectDisk, type ToilProjectDisk } from '../../test/harness/toil-projects.js';
import { loadModel, type C4Model } from '../areas/util/c4/model.js';
import type { ResolvedConfig } from '../core/config.js';
import { checkStorable, countsOf, DIAGRAM_SCHEMA_VERSION } from '../core/diagrams.js';
import type { Envelope } from '../core/envelope.js';
import { execute } from '../core/run.js';
import { areas } from '../registry.js';
import { toilProjectBuildCommands } from './build.js';
import { diagramCommands } from './diagram.js';

const commands = [...diagramCommands(), ...toilProjectBuildCommands(areas)];
const config: ResolvedConfig = { connections: {}, defaults: {}, sources: {}, files: { global: '/home/test/.toil/config.json' }, warnings: [] };

const model = (): C4Model => JSON.parse(BOOKSHOP_C4) as C4Model;
const marked = (): C4Model => {
  const m = model();
  m.systems[0]!.containers![0]!.how = 'observed';
  m.systems[0]!.containers![0]!.source = 'docker-compose.yml:4';
  m.systems[0]!.containers![1]!.how = 'inferred';
  m.systems[0]!.containers![1]!.reason = 'the ORM names one';
  return m;
};

const disks: ToilProjectDisk[] = [];
const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  for (const d of disks.splice(0)) d.cleanup();
});

function disk(files: Record<string, unknown> = {}): ToilProjectDisk {
  const d = toilProjectDisk({ 'home/.toil/projects/payments.json': { name: 'payments', repos: [] }, ...files });
  disks.push(d);
  return d;
}

const ctxFor = (d: ToilProjectDisk, mcp = false, files: Record<string, string> = {}) => {
  const made = testContext({ config: {}, files });
  return { ...made, context: { ...made.context, toilProjects: d.catalog(config, { mcp }), diagrams: d.diagrams() } };
};

async function cli(d: ToilProjectDisk, argv: string[], files: Record<string, string> = {}): Promise<Envelope> {
  const { context } = ctxFor(d, false, files);
  return (await runCli(argv, { commands, context })).envelope!;
}

async function mcp(d: ToilProjectDisk, files: Record<string, string> = {}) {
  const { context } = ctxFor(d, true, files);
  const session = await connectMcp({ commands, context });
  sessions.push(session);
  return session;
}

const data = (e: Envelope) => {
  expect(e.ok, JSON.stringify(e.error)).toBe(true);
  return e.data as Record<string, any>;
};
const stored = (d: ToilProjectDisk, name = 'payments') => JSON.parse(readFileSync(join(d.home, '.toil', 'diagrams', `${name}.json`), 'utf8')) as Record<string, any>;
const text = (m: C4Model) => JSON.stringify(m);
const find = (path: string) => commands.find((c) => c.path.join(' ') === path)!;

describe('the stored-diagram checks', () => {
  it('pass a clean model, and say nothing about a file and line', () => {
    expect(checkStorable(marked(), ['dist/'])).toEqual([]);
  });

  it('name every URL and token-shaped value by path, never quoting it', () => {
    const m = marked();
    m.systems[0]!.description = 'See https://wiki.imagile.dev/bookshop';
    m.systems[0]!.containers![0]!.source = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    m.people![0]!.description = 'password=hunter2hunter2';
    const problems = checkStorable(m, ['ok/', 'ftp://host/dir']);
    const paths = problems.map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(['systems[0].description', 'systems[0].containers[0].source', 'people[0].description', 'notMapped[1]']));
    expect(JSON.stringify(problems)).not.toMatch(/ghp_|hunter2|wiki\.imagile/);
  });

  it('counts what is observed, inferred and unmarked, elements and relationships together', () => {
    const c = countsOf(marked());
    expect(c.observed).toBe(1);
    expect(c.inferred).toBe(1);
    expect(c.observed + c.inferred + c.unmarked).toBe(c.elements + c.relationships);
  });
});

describe('projects diagram check', () => {
  it('checks as save would, returns the views and counts, and keeps nothing', async () => {
    const d = disk();
    const out = data(await cli(d, ['projects', 'diagram', 'check', '--text', text(marked()), '--not-mapped', 'dist/']));
    expect(out.views.map((v: any) => v.key)).toEqual(model().views.map((v) => v.key));
    expect(out.counts).toMatchObject({ observed: 1, inferred: 1 });
    expect(out.notMapped).toEqual(['dist/']);
    expect(out).not.toHaveProperty('view');
    expect(existsSync(join(d.home, '.toil', 'diagrams'))).toBe(false);
  });

  it('with --view also returns the computed view, each element carrying how, source and reason', async () => {
    const d = disk();
    const out = data(await cli(d, ['projects', 'diagram', 'check', 'm.json', '--view', 'containers'], { 'm.json': text(marked()) }));
    expect(out.view.key).toBe('containers');
    expect(out.view.inside.find((e: any) => e.how === 'inferred')).toMatchObject({ reason: 'the ORM names one' });
  });

  it('refuses every problem at once by path: model mistakes and addresses alike', async () => {
    const d = disk();
    const m = model();
    m.systems[0]!.description = 'at https://x.imagile.dev';
    const e = await cli(d, ['projects', 'diagram', 'check', '--text', text(m)]);
    expect(e.error?.code).toBe('INVALID_INPUT');
    expect(e.error?.message).toContain('systems[0].description');
    expect(e.error?.fix).toContain('Cite the file and line or the command');
    const bad = await cli(d, ['projects', 'diagram', 'check', '--text', JSON.stringify({ systems: [], views: [] })]);
    expect(bad.error?.code).toBe('INVALID_INPUT');
  });
});

describe('projects diagram save', () => {
  it('stores the diagram under the toil project, revision 1, and returns where', async () => {
    const d = disk();
    const out = data(await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(marked()), '--not-mapped', 'dist/']));
    expect(out).toMatchObject({ toilProject: 'payments', revision: 1, file: join(d.home, '.toil', 'diagrams', 'payments.json').split('\\').join('/') });
    expect(out.counts.inferred).toBe(1);
    expect(stored(d)).toMatchObject({ schemaVersion: DIAGRAM_SCHEMA_VERSION, toilProject: 'payments', revision: 1, toilVersion: '0.0.0-test', notMapped: ['dist/'] });
    expect(loadModel(JSON.stringify(stored(d).model), 'stored').views.length).toBeGreaterThan(0);
    expect(readdirSync(join(d.home, '.toil', 'diagrams'))).toEqual(['payments.json']);
  });

  it('refuses a second save naming the diagram, and --replace replaces it with the revision one higher', async () => {
    const d = disk();
    data(await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(model())]));
    const again = await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(marked())]);
    expect(again.error?.code).toBe('INVALID_INPUT');
    expect(again.error?.message).toContain('already has a diagram');
    expect(again.error?.fix).toContain('--replace');
    const out = data(await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(marked()), '--replace']));
    expect(out.revision).toBe(2);
    expect(stored(d).model.systems[0].containers[0].how).toBe('observed');
  });

  it('refuses an unknown toil project, and a model with a URL, leaving nothing behind', async () => {
    const d = disk();
    expect((await cli(d, ['projects', 'diagram', 'save', 'nope', '--text', text(model())])).error?.code).toBe('INVALID_INPUT');
    const m = model();
    m.systems[0]!.containers![0]!.technology = 'https://registry.imagile.dev/x';
    const e = await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(m)]);
    expect(e.error?.message).toContain('systems[0].containers[0].technology');
    expect(existsSync(join(d.home, '.toil', 'diagrams'))).toBe(false);
  });

  it('never replaces a file that is not a diagram', async () => {
    const d = disk({ 'home/.toil/diagrams/payments.json': { not: 'a diagram' } });
    const e = await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(model()), '--replace']);
    expect(e.error?.message).toContain("isn't a valid diagram");
    expect(stored(d)).toEqual({ not: 'a diagram' });
  });

  it('refuses a diagrams folder that is a link out of ~/.toil, and a file that is one', async () => {
    const away = disk({ 'away/keep.txt': 'x' });
    const d = disk();
    mkdirSync(join(d.home, '.toil'), { recursive: true });
    symlinkSync(join(away.root, 'away'), join(d.home, '.toil', 'diagrams'), 'junction');
    const e = await cli(d, ['projects', 'diagram', 'save', 'payments', '--text', text(model())]);
    expect(e.error?.message).toContain('outside');
    expect(readdirSync(join(away.root, 'away'))).toEqual(['keep.txt']);
    const d2 = disk();
    mkdirSync(join(d2.home, '.toil', 'diagrams'), { recursive: true });
    writeFileSync(join(away.root, 'away', 'elsewhere.json'), '{}');
    try {
      symlinkSync(join(away.root, 'away', 'elsewhere.json'), join(d2.home, '.toil', 'diagrams', 'payments.json'), 'file');
    } catch {
      return; // a file link needs a privilege some Windows machines withhold; the folder link above has already been judged
    }
    const e2 = await cli(d2, ['projects', 'diagram', 'save', 'payments', '--text', text(model()), '--replace']);
    expect(e2.error?.message).toContain('outside');
    expect(readFileSync(join(away.root, 'away', 'elsewhere.json'), 'utf8')).toBe('{}');
  });

  it('keeps the SHA-256 of the model in the audit line, never the model', async () => {
    const d = disk();
    const made = ctxFor(d);
    const body = text(marked());
    const env = await execute(find('projects diagram save'), { toilProject: 'payments', text: body }, made.context, 'cli');
    expect(env.ok).toBe(true);
    const line = made.audit.lines.join('\n');
    expect(line).not.toContain('Online Bookshop');
    expect(line).toContain(createHash('sha256').update(body).digest('hex'));
  });

  it('is served over MCP, and refused read-only', async () => {
    const d = disk();
    const s = await mcp(d);
    expect(data((await s.call('projects_diagram_save', { toilProject: 'payments', text: text(model()) })).envelope).revision).toBe(1);
    const made = ctxFor(d);
    const ro = await execute(find('projects diagram save'), { toilProject: 'payments', text: text(model()), replace: true }, made.context, 'api', { readOnly: true });
    expect(ro.error?.message).toMatch(/read-only/);
    expect(stored(d).revision).toBe(1);
  });
});

describe('projects diagram show, list and remove', () => {
  const seeded = () => disk({ 'home/.toil/diagrams/payments.json': { schemaVersion: 1, toilProject: 'payments', revision: 3, savedAt: '2026-11-01T09:00:00.000Z', toilVersion: '0.1.0', model: marked(), notMapped: ['dist/'] } });

  it('shows the stored model, its views and counts, and with --view the computed view', async () => {
    const d = seeded();
    const out = data(await cli(d, ['projects', 'diagram', 'show', 'payments', '--view', 'containers']));
    expect(out).toMatchObject({ toilProject: 'payments', revision: 3, toilVersion: '0.1.0', notMapped: ['dist/'] });
    expect(out.model.systems).toHaveLength(model().systems.length);
    expect(out.view.boundary.id).toBe('bookshop');
  });

  it('a toil project with no diagram is NOT_FOUND, naming save', async () => {
    const e = await cli(disk(), ['projects', 'diagram', 'show', 'payments']);
    expect(e.error?.code).toBe('NOT_FOUND');
    expect(e.error?.fix).toContain('toil projects diagram save payments');
  });

  it('refuses a file from a newer toil with an upgrade fix, and names a malformed one', async () => {
    const newer = disk({ 'home/.toil/diagrams/payments.json': { schemaVersion: 2, toilProject: 'payments' } });
    const e = await cli(newer, ['projects', 'diagram', 'show', 'payments']);
    expect(e.error?.code).toBe('CONFIG_INVALID');
    expect(e.error?.fix).toContain('Upgrade toil');
    const broken = disk({ 'home/.toil/diagrams/payments.json': '{ nope' });
    const b = await cli(broken, ['projects', 'diagram', 'show', 'payments']);
    expect(b.error?.code).toBe('CONFIG_INVALID');
    expect(b.error?.message).toContain('payments.json');
  });

  it('lists diagrams with whether their toil project is known, and skips a broken file with a warning', async () => {
    const d = disk({
      'home/.toil/diagrams/payments.json': { schemaVersion: 1, toilProject: 'payments', revision: 1, savedAt: '2026-11-01T09:00:00.000Z', toilVersion: '0.1.0', model: model() },
      'home/.toil/diagrams/gone.json': { schemaVersion: 1, toilProject: 'gone', revision: 2, savedAt: '2026-11-01T09:00:00.000Z', toilVersion: '0.1.0', model: model() },
      'home/.toil/diagrams/broken.json': '{ nope',
    });
    const e = await cli(d, ['projects', 'diagram', 'list']);
    const out = data(e);
    expect(out.diagrams.map((x: any) => [x.toilProject, x.revision, x.known, x.views])).toEqual([
      ['gone', 2, false, model().views.length],
      ['payments', 1, true, model().views.length],
    ]);
    expect(e.meta.warnings?.[0]).toMatchObject({ code: 'DIAGRAM_SKIPPED' });
  });

  it('removes only a valid diagram, on the CLI, and projects remove says the diagram was kept', async () => {
    const d = seeded();
    const removed = await cli(d, ['projects', 'remove', 'payments']);
    expect(data(removed).deleted).toBe(true);
    expect(removed.meta.warnings?.some((w) => w.code === 'DIAGRAM_KEPT' && w.message.includes('toil projects diagram remove payments'))).toBe(true);
    expect(data(await cli(d, ['projects', 'diagram', 'remove', 'payments'])).deleted).toBe(true);
    expect(existsSync(join(d.home, '.toil', 'diagrams', 'payments.json'))).toBe(false);
    const junk = disk({ 'home/.toil/diagrams/payments.json': { x: 1 } });
    expect((await cli(junk, ['projects', 'diagram', 'remove', 'payments'])).error?.message).toContain('only ever deletes a diagram');
    expect(existsSync(join(junk.home, '.toil', 'diagrams', 'payments.json'))).toBe(true);
  });

  it('over MCP serves check, save, show and list, but not remove', async () => {
    const d = seeded();
    const s = await mcp(d);
    const tools = (await s.client.listTools()).tools.map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['projects_diagram_check', 'projects_diagram_save', 'projects_diagram_show', 'projects_diagram_list']));
    expect(tools).not.toContain('projects_diagram_remove');
    expect(data((await s.call('projects_diagram_list', {})).envelope).diagrams).toHaveLength(1);
    expect(data((await s.call('projects_diagram_show', { toilProject: 'payments', view: 'context' })).envelope).view.key).toBe('context');
  });
});
