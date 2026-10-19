import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutePerson, Question } from '../src/api.js';
import { CONSENT_VERSION, DISCLAIMER, FEEDBACK_ENDPOINT } from '../src/feedback/consent.js';
import { areas } from '../src/registry.js';
import { fakeFetch } from './harness/fake-fetch.js';
import { clearConnectionEnv } from './harness/hermetic-env.js';

// A bundle knows its commit; a source run doesn't, so the test gives it one.
vi.mock('../src/version.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/version.js')>()),
  COMMIT: 'abc1234500000000000000000000000000000000',
}));

const { execute, registry } = await import('../src/api.js');

/**
 * `feedback` through `@imagile-dev/toil/api` (AGENT_DECISIONS.md, #265): a
 * person's command, sent only on the person's yes to its `consent` question.
 * A program can't approve one itself, and a read-only call only previews.
 */

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'toil-api-feedback-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('TOIL_FEEDBACK_URL', '');
  clearConnectionEnv(areas);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const input = { kind: 'feature', title: 'A --since flag', body: 'Only issues updated today.', email: 'you@example.com' };

function person(answer: string | undefined): ExecutePerson & { asked: Question[] } {
  const asked: Question[] = [];
  return { asked, ask: (q) => (asked.push(q), q.id === 'consent' ? answer : undefined) };
}

function endpoint() {
  const http = fakeFetch([{ method: 'POST', url: FEEDBACK_ENDPOINT, respond: { status: 202, json: { ok: true, message: 'Thanks.' } } }]);
  vi.stubGlobal('fetch', http.fetch);
  return http;
}

describe('feedback through the API', () => {
  it("isn't served without a person, and isn't an MCP-shaped command", () => {
    expect(registry.commands.map((c) => c.name)).not.toContain('feedback');
    expect(registry.personCommands.find((c) => c.name === 'feedback')).toMatchObject({ kind: 'cli-only', writes: false, writesLocal: false });
  });

  it('refuses a call with no person', async () => {
    const http = endpoint();
    const out = await execute('feedback', input);
    expect(out.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(out.error?.message).toContain("person's command");
    expect(http.calls).toEqual([]);
  });

  it("sends only on the person's yes, after showing them the report and the disclaimer", async () => {
    const http = endpoint();
    const yes = person('yes');
    const out = await execute('feedback', input, { person: yes, caller: 'toil-ui' });
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ sent: true, consentVersion: CONSENT_VERSION });
    expect(yes.asked).toHaveLength(1);
    expect(yes.asked[0]).toMatchObject({ id: 'consent', secret: false, fallback: 'no' });
    expect(yes.asked[0]!.text).toContain(DISCLAIMER);
    expect(yes.asked[0]!.text).toContain('"title": "A --since flag"');
    expect(http.calls).toHaveLength(1);
    expect(JSON.parse(http.calls[0]!.body!)).toMatchObject({ ...input, consent: CONSENT_VERSION, commit: 'abc1234500000000000000000000000000000000' });
  });

  it('sends nothing on no, or on no answer', async () => {
    const http = endpoint();
    expect((await execute('feedback', input, { person: person('no') })).data).toMatchObject({ sent: false });
    expect((await execute('feedback', input, { person: person(undefined) })).error).toMatchObject({ code: 'CANCELLED', message: 'Nothing was sent: the report was not approved.' });
    expect(http.calls).toEqual([]);
  });

  it('only previews a read-only call: the person is asked nothing', async () => {
    const http = endpoint();
    const p = person('yes');
    const out = await execute('feedback', input, { person: p, readOnly: true });
    expect(out.data).toMatchObject({ sent: false, report: { ...input, consent: CONSENT_VERSION }, disclaimer: DISCLAIMER });
    expect(p.asked).toEqual([]);
    expect(http.calls).toEqual([]);
  });

  it('refuses consent as a field: a program never approves a report itself', async () => {
    const http = endpoint();
    const out = await execute('feedback', { ...input, consent: true }, { person: person('yes') });
    expect(out.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(out.error?.message).toContain("consent isn't taken from a program");
    expect(http.calls).toEqual([]);
  });
});
