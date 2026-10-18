import { afterEach, describe, expect, it } from 'vitest';
import type { Settings } from '../src/core/config.js';
import { viewScopes, type DossierView } from '../src/core/dossier.js';
import type { Envelope } from '../src/core/envelope.js';
import { areas, commands } from '../src/registry.js';
import { fixture as ado } from './fixtures/ado.fixture.js';
import { fixture as bitbucket } from './fixtures/bitbucket.fixture.js';
import { fixture as dynatrace } from './fixtures/dynatrace.fixture.js';
import { fixture as github } from './fixtures/github.fixture.js';
import { fixture as jiraCloud } from './fixtures/jira-cloud.fixture.js';
import { fixture as openshift } from './fixtures/openshift.fixture.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { dossierDisk, type DossierDisk } from './harness/dossiers.js';
import type { Route } from './harness/fake-fetch.js';
import type { AreaFixture } from './harness/fixtures.js';

/**
 * `toil <area> check-dossier` for ado, openshift, dynatrace, bitbucket, github
 * and jira-cloud: what each looks up, how per-repo values pair up (a repo with
 * its project or owner), a value the service hasn't got, and that only the
 * call's own environment is checked. The parity suite already runs each
 * one's examples through both doors; this proves what they find.
 */

const dossierAreas = areas.map((a) => ({ name: a.name, context: Object.keys(a.context) }));
const disks: DossierDisk[] = [];
afterEach(() => disks.splice(0).forEach((d) => d.cleanup()));

/** 404 for any GET no fixture route answers, as each service does for a value it hasn't got. */
const missing: Route = { path: /.*/, respond: { status: 404, json: { message: 'Not Found', errors: [{ message: 'Not Found' }], errorMessages: ['Not Found'] } } };

async function check(f: AreaFixture, dossier: Record<string, unknown>, extra: string[] = [], config: Record<string, Settings> = f.config ?? {}): Promise<{ envelope: Envelope; exitCode: number; urls: string[] }> {
  const d = dossierDisk({ [`home/.toil/dossiers/${String(dossier.name)}.json`]: dossier });
  disks.push(d);
  const { context, http } = testContext({ config, routes: [...(f.routes ?? []), missing], dossiers: (c) => d.catalog(c, { areas: dossierAreas }) });
  const run = await runCli([f.area, 'check-dossier', '--dossier', String(dossier.name), ...extra], { commands, context });
  return { envelope: run.envelope!, exitCode: run.exitCode, urls: http.calls.map((c) => new URL(c.url).pathname + new URL(c.url).search) };
}

const found = (e: Envelope) => (e.data as { checks: Array<{ path: string; kind: string; value: string; found: boolean }> }).checks.map((c) => [c.path, c.kind, c.value, c.found]);

describe('check-dossier for the rest of the areas', () => {
  it('ado: projects in their collection and repos in their project, the collection per repo or from the call', async () => {
    const run = await check(ado, { name: 'p', ado: { collection: { 'imagile-api': 'DefaultCollection' }, project: { 'imagile-api': 'Imagile', ops: 'Gone' }, repo: { 'imagile-api': 'imagile-api' } } }, ['--collection', 'DefaultCollection']);
    expect(found(run.envelope)).toEqual([
      ['ado (imagile-api).project', 'project', 'DefaultCollection/Imagile', true],
      ['ado (ops).project', 'project', 'DefaultCollection/Gone', false],
      ['ado (imagile-api).repo', 'repo', 'DefaultCollection/Imagile/imagile-api', true],
    ]);
    expect(run.exitCode).toBe(1);
    const orphan = await check(ado, { name: 'p', ado: { projects: ['Imagile'] } });
    expect(orphan.envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: 'ado.projects[0] names "Imagile", but there\'s no collection to look it up in.' });
    expect(orphan.urls).toEqual([]);
  });

  it("openshift: only the call's environment, and each deployment in its section's namespace", async () => {
    const dossier = {
      name: 'p',
      env: 'test',
      environments: { prod: { openshift: { namespace: 'payments', deployments: ['api', 'worker'] } }, test: { openshift: { namespace: 'payments-test' } } },
    };
    const prod = await check(openshift, dossier, ['--env', 'prod']);
    expect(found(prod.envelope)).toEqual([
      ['environments.prod.openshift.namespace', 'namespace', 'payments', true],
      ['environments.prod.openshift.deployments[0]', 'deployment', 'payments/api', true],
      ['environments.prod.openshift.deployments[1]', 'deployment', 'payments/worker', false],
    ]);
    expect(prod.envelope.data).toMatchObject({ env: 'prod', ok: false });
    // With no --env, the dossier's own environment, test: whose cluster this connection (env prod) isn't, so a person would pass --env.
    const test = await check(openshift, dossier, [], { openshift: { ...openshift.config!.openshift, env: 'test' } });
    expect(found(test.envelope)).toEqual([['environments.test.openshift.namespace', 'namespace', 'payments-test', false]]);
    expect(test.urls).toEqual(['/apis/project.openshift.io/v1/projects/payments-test']);
  });

  it('dynatrace: each entity id', async () => {
    const run = await check(dynatrace, { name: 'p', dynatrace: { entities: ['SERVICE-ABC12345', 'HOST-GONE'] } });
    expect(found(run.envelope)).toEqual([
      ['dynatrace.entities[0]', 'entity', 'SERVICE-ABC12345', true],
      ['dynatrace.entities[1]', 'entity', 'HOST-GONE', false],
    ]);
  });

  it('bitbucket: projects, and each repo paired with its own repo\'s project', async () => {
    const run = await check(bitbucket, { name: 'p', bitbucket: { project: { 'imagile-api': 'PROJ', ledger: 'PROJ' }, repo: { 'imagile-api': 'imagile-api', ledger: 'ledger' } } });
    expect(found(run.envelope)).toEqual([
      ['bitbucket.project.imagile-api', 'project', 'PROJ', true],
      ['bitbucket.project.ledger', 'project', 'PROJ', true],
      ['bitbucket (imagile-api).repo', 'repo', 'PROJ/imagile-api', true],
      ['bitbucket (ledger).repo', 'repo', 'PROJ/ledger', false],
    ]);
    // Each value looked up once.
    expect(run.urls.filter((u) => u === '/rest/api/1.0/projects/PROJ')).toHaveLength(1);
  });

  it('github: owners, and each repo under its owner', async () => {
    const run = await check(github, { name: 'p', github: { owner: 'imagile', repo: { 'toil-probe': 'toil-probe', gone: 'gone' } } });
    expect(found(run.envelope)).toEqual([
      ['github.owner', 'owner', 'imagile', true],
      ['github (toil-probe).repo', 'repo', 'imagile/toil-probe', true],
      ['github (gone).repo', 'repo', 'imagile/gone', false],
    ]);
  });

  it('jira-cloud: projects and field ids', async () => {
    const run = await check(jiraCloud, { name: 'p', 'jira-cloud': { projects: ['PROJ', 'GONE'], fields: { storyPoints: 'customfield_10016', ghost: 'customfield_1' } } });
    expect(found(run.envelope)).toEqual([
      ['jira-cloud.projects[0]', 'project', 'PROJ', true],
      ['jira-cloud.projects[1]', 'project', 'GONE', false],
      ['jira-cloud.fields.storyPoints', 'field', 'customfield_10016', true],
      ['jira-cloud.fields.ghost', 'field', 'customfield_1', false],
    ]);
  });

  it('fails, rather than calling a value missing, when the service answers with anything but not-found', async () => {
    const d = dossierDisk({ 'home/.toil/dossiers/p.json': { name: 'p', dynatrace: { entities: ['SERVICE-1'] } } });
    disks.push(d);
    const { context } = testContext({ config: dynatrace.config!, routes: [{ path: /.*/, respond: { status: 401, json: { error: { message: 'Token is invalid' } } } }], dossiers: (c) => d.catalog(c, { areas: dossierAreas }) });
    const run = await runCli(['dynatrace', 'check-dossier', '--dossier', 'p'], { commands, context });
    expect(run.envelope?.error?.code).toBe('AUTH');
  });
});

describe('viewScopes', () => {
  const view = (values: Record<string, unknown>): DossierView => ({ name: 'p', source: 'user', file: '', env: null, sections: [{ path: 'x', env: null, values }] });

  it('pairs a per-repo value with a plain one, or with the same repo\'s, and leaves out a scope missing a key', () => {
    expect(viewScopes(view({ owner: 'o', repo: { a: 'ra', b: 'rb' } }), ['owner', 'repo'])).toEqual([
      { path: 'x (a)', repo: 'a', values: { owner: 'o', repo: 'ra' } },
      { path: 'x (b)', repo: 'b', values: { owner: 'o', repo: 'rb' } },
    ]);
    expect(viewScopes(view({ owner: { a: 'oa' }, repo: { a: 'ra', b: 'rb' } }), ['owner', 'repo'])).toEqual([{ path: 'x (a)', repo: 'a', values: { owner: 'oa', repo: 'ra' } }]);
    expect(viewScopes(view({ owner: 'o', repo: 'r' }), ['owner', 'repo'])).toEqual([{ path: 'x', repo: null, values: { owner: 'o', repo: 'r' } }]);
  });
});
