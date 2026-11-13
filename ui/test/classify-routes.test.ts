// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fixtureAgent } from '../server/agent.ts';
import { ClassifyRefusal, sampleBackend, type ClassifyBackend } from '../server/classify.ts';
import { createUiServer } from '../server/server.ts';
import { fixtureStore } from '../server/store.ts';
import { SAMPLE_TEAM } from '../src/fixtures/sample-team.ts';
import type { WorkItem } from '../src/toil.ts';
import { letIn } from './let-in.ts';

/**
 * `api/classify/*` (#566): the page names a Toil project and sends items or ids, and nothing else decides what runs. These
 * are the doors: the sample's script behind them, a refusal as the page shows it, and the bodies it won't take.
 */

/** The parts of an answer these tests read. */
interface Body {
  error?: { message: string; fix: string };
  scheme?: { name: string };
  stats?: { sinceLastTune: number };
  answers?: unknown[];
}

let close: (() => Promise<void>) | undefined;
let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'toil-ui-classify-routes-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
});
afterEach(async () => {
  await close?.();
  close = undefined;
  rmSync(dir, { recursive: true, force: true });
});

async function serve(classify?: ClassifyBackend) {
  const ui = createUiServer({
    settings: { host: '127.0.0.1', port: 0, basePath: '/', dataDir: dir, retentionDays: 30, sample: true },
    store: fixtureStore(),
    agent: fixtureAgent(),
    appDir: dir,
    version: '0.0.0-test',
    toil: { version: '0.0.0-test', contractVersion: 1 },
    ...(classify ? { classify } : {}),
  });
  const { origin } = await ui.listen();
  close = () => ui.close();
  const cookie = await letIn(origin);
  const call = async (path: string, body?: unknown) => {
    const res = await fetch(new URL(path, origin), { method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: (await res.json()) as Body };
  };
  return call;
}

const items = (SAMPLE_TEAM.owi.items as WorkItem[]).slice(0, 3);

describe('the classify routes', () => {
  it('has no route that records verdicts on its own: a correction records them itself', async () => {
    const call = await serve(sampleBackend());
    const res = await call('/api/classify/record', { toilProject: 'sample-team', items });
    expect(res.status).toBe(404);
    expect(res.body.error?.message).not.toMatch(/record,/);
  });

  it("answer from the sample's script, which reads a ledger and writes nothing", async () => {
    const call = await serve(sampleBackend());
    const ledger = await call('/api/classify/ledger?toilProject=sample-team');
    expect(ledger.status).toBe(200);
    expect(ledger.body.scheme?.name).toBe('ktlo-feature');
    expect(ledger.body.stats?.sinceLastTune).toBeGreaterThanOrEqual(10);
    const asked = await call('/api/classify/ask', { toilProject: 'sample-team', items });
    expect(asked.status).toBe(200);
    expect(asked.body.answers).toHaveLength(3);
    const applied = await call('/api/classify/apply', { toilProject: 'sample-team', plan: 'sample-plan' });
    expect(applied.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(applied.body)).toMatch(/sample data/);
  });

  it('say there is nothing here when the server has no service', async () => {
    const call = await serve();
    const r = await call('/api/classify/ledger?toilProject=sample-team');
    expect(r.status).toBe(404);
    expect(r.body.error?.message).toMatch(/sorts no work into categories/);
  });

  it("show a refusal the way every other refusal is shown, with its status and its fix", async () => {
    const refusing: ClassifyBackend = { ...sampleBackend(), apply: async () => { throw new ClassifyRefusal('Changes to corp-jira are switched off.', 'Turn them on under Settings, Connections.', 403); } };
    const call = await serve(refusing);
    const r = await call('/api/classify/apply', { toilProject: 'sample-team', plan: 'p1' });
    expect(r.status).toBe(403);
    expect(r.body.error).toEqual({ message: 'Changes to corp-jira are switched off.', fix: 'Turn them on under Settings, Connections.' });
  });

  it("refuse a body that isn't what a call takes, before any service runs", async () => {
    const call = await serve(sampleBackend());
    expect((await call('/api/classify/ledger?toilProject=../etc')).status).toBe(400);
    expect((await call('/api/classify/ask', { toilProject: 'sample-team', items: 'all of them' })).status).toBe(400);
    expect((await call('/api/classify/ask', { toilProject: 'sample-team', items: [{ title: 'no id' }] })).status).toBe(400);
    expect((await call('/api/classify/ask', { toilProject: 'sample-team', items, adapter: 'rm -rf' })).status).toBe(400);
    expect((await call('/api/classify/plan', { toilProject: 'sample-team', items: 'x' })).status).toBe(400);
    expect((await call('/api/classify/correct', { toilProject: 'sample-team', item: items[0], to: 'Not An Id', reason: '' })).status).toBe(400);
    expect((await call('/api/classify/correct', { toilProject: 'sample-team', item: items[0], to: null, reason: 'x'.repeat(301) })).status).toBe(400);
    expect((await call('/api/classify/revision/apply', {})).status).toBe(400);
    expect((await call('/api/classify/apply', { toilProject: 'sample-team', items })).status).toBe(400);
  });

  it('take no command, file or path from the page: anything else under classify is not in the API', async () => {
    const call = await serve(sampleBackend());
    const r = await call('/api/classify/run', { command: 'jira issue categorize', input: { from: 'C:/secrets.json', allowWrite: true } });
    expect(r.status).toBe(404);
    expect(r.body.error?.message).toMatch(/There is no POST classify\/run in the API/);
  });
});
