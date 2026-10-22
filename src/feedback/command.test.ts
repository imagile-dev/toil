import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { terminalPrompter } from '../core/prompt.js';
import { servedOverMcp } from '../core/command.js';
import { commands } from '../registry.js';
import { runCli } from '../../test/harness/cli.js';
import { scriptedPrompter, testContext } from '../../test/harness/context.js';
import type { Route } from '../../test/harness/fake-fetch.js';
import { feedbackCommands } from './command.js';
import { CONSENT_VERSION, DISCLAIMER, FEEDBACK_ENDPOINT, FEEDBACK_FORM } from './consent.js';

/**
 * `toil feedback`: nothing leaves without approval of the exact report, and
 * what leaves is the caller's fields plus toil's version and commit. Every
 * request goes to a fake fetch; the real endpoint is never called.
 */

const COMMIT = 'abc1234500000000000000000000000000000000';
const defs = feedbackCommands(COMMIT);
const accepted: Route = { method: 'POST', url: FEEDBACK_ENDPOINT, respond: { status: 202, json: { ok: true, message: 'Thanks. Your report is queued.' } } };
const args = ['feedback', 'bug', '--title', 'jira issue search ignores --limit', '--body', 'It returns 50.', '--email', 'you@example.com'];
const expected = { kind: 'bug', title: 'jira issue search ignores --limit', body: 'It returns 50.', email: 'you@example.com', consent: CONSENT_VERSION, version: '0.0.0-test', commit: COMMIT };

describe('toil feedback', () => {
  it('sends nothing without --consent off a terminal, and returns the exact report, the disclaimer and how to approve', async () => {
    const { context, http } = testContext({ routes: [accepted] });
    const run = await runCli(args, { commands: defs, context });
    expect(run.exitCode).toBe(0);
    expect(http.calls).toEqual([]);
    expect(run.envelope?.data).toMatchObject({ sent: false, endpoint: FEEDBACK_ENDPOINT, report: expected, consentVersion: CONSENT_VERSION, disclaimer: DISCLAIMER });
    expect((run.envelope?.data as { approve: string }).approve).toContain('--consent');
    expect(run.envelope?.meta.warnings?.[0]).toMatchObject({ code: 'FEEDBACK_NOT_SENT' });
  });

  it('sends exactly the previewed report with --consent, and nothing else', async () => {
    const { context, http } = testContext({ routes: [accepted] });
    const run = await runCli([...args, '--consent'], { commands: defs, context });
    expect(run.envelope?.ok).toBe(true);
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0]).toMatchObject({ method: 'POST', url: FEEDBACK_ENDPOINT });
    expect(http.calls[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(http.calls[0]!.body!)).toEqual(expected);
    expect(run.envelope?.data).toMatchObject({ sent: true, report: expected, message: 'Thanks. Your report is queued.' });
  });

  it('never adds config: connections, hosts and tokens stay out of the report', async () => {
    const { context, http } = testContext({ routes: [accepted], config: { jira: { baseUrl: 'https://jira.imagile.dev', apiToken: 'fake-token-abc12345' } } });
    await runCli([...args, '--consent'], { commands: defs, context });
    expect(http.calls[0]!.body).not.toMatch(/jira\.imagile\.dev|fake-token|connection/);
    expect(Object.keys(JSON.parse(http.calls[0]!.body!)).sort()).toEqual(['body', 'commit', 'consent', 'email', 'kind', 'title', 'version']);
  });

  it('on a terminal, shows the report and the disclaimer and sends only on yes', async () => {
    const yes = scriptedPrompter({ 'toil would send': 'yes' });
    const sent = testContext({ routes: [accepted], prompt: yes.prompt });
    const run = await runCli(args, { commands: defs, context: sent.context });
    expect(run.envelope?.data).toMatchObject({ sent: true });
    expect(sent.http.calls).toHaveLength(1);
    expect(yes.asked[0]!.question).toContain(JSON.stringify(expected, null, 2));
    expect(yes.asked[0]!.question).toContain(DISCLAIMER);

    for (const answer of ['no', '', 'sure']) {
      const p = scriptedPrompter({ 'toil would send': answer });
      const declined = testContext({ routes: [accepted], prompt: p.prompt });
      const out = await runCli(args, { commands: defs, context: declined.context });
      expect(out.envelope?.data, answer).toMatchObject({ sent: false });
      expect(out.envelope?.meta.warnings?.[0]?.message).toBe('Nothing was sent: the report was not approved.');
      expect(declined.http.calls).toEqual([]);
    }
  });

  it("on a real terminal's prompter, shows the whole report before asking, and Ctrl+C sends nothing", async () => {
    const terminal = () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let shown = '';
      output.on('data', (chunk: Buffer) => (shown += chunk.toString()));
      return { input, prompt: terminalPrompter(input, output), shown: () => shown };
    };
    const yes = terminal();
    const sent = testContext({ routes: [accepted], prompt: yes.prompt });
    const running = runCli(args, { commands: defs, context: sent.context });
    await vi.waitFor(() => expect(yes.shown()).toContain('Type yes to send it [no]: '));
    expect(yes.shown()).toContain(DISCLAIMER);
    yes.input.write('yes\r');
    expect((await running).envelope?.data).toMatchObject({ sent: true });

    const quit = terminal();
    const cancelled = testContext({ routes: [accepted], prompt: quit.prompt });
    const stopped = runCli(args, { commands: defs, context: cancelled.context });
    await vi.waitFor(() => expect(quit.shown()).toContain('Type yes to send it'));
    quit.input.write('\u0003');
    expect((await stopped).envelope?.error).toMatchObject({ code: 'CANCELLED', message: 'Nothing was sent: the report was not approved.' });
    expect(cancelled.http.calls).toEqual([]);
  });

  it('reads --input-file, with a flag beating the file, and refuses a key it does not know', async () => {
    const file = JSON.stringify({ kind: 'feature', title: 'From the file', body: 'Line one\r\nLine two', email: 'you@example.com' });
    const { context } = testContext({ files: { 'report.json': file } });
    const run = await runCli(['feedback', '--input-file', 'report.json', '--title', 'From the flag'], { commands: defs, context });
    expect((run.envelope?.data as { report: unknown }).report).toMatchObject({ kind: 'feature', title: 'From the flag', body: 'Line one\nLine two' });

    const bad = testContext({ files: { 'report.json': JSON.stringify({ kind: 'bug', host: 'jira.imagile.dev' }) } });
    const refused = await runCli(['feedback', '--input-file', 'report.json'], { commands: defs, context: bad.context });
    expect(refused.envelope?.error).toMatchObject({ code: 'INVALID_INPUT' });
    expect(refused.envelope?.error?.message).toContain('host');
  });

  it.each([
    [['feedback', '--title', 't', '--body', 'b', '--email', 'you@example.com'], 'bug or feature'],
    [['feedback', 'bug', '--title', 'x'.repeat(121), '--body', 'b', '--email', 'you@example.com'], '1 to 120 characters'],
    [['feedback', 'bug', '--title', 't', '--body', '  ', '--email', 'you@example.com'], '1 to 4000 characters'],
    [['feedback', 'bug', '--title', 't', '--body', 'b', '--email', 'not-an-address'], "isn't an email address"],
  ])('refuses a report the endpoint would refuse, before anything is sent: %j', async (argv, message) => {
    const { context, http } = testContext({ routes: [accepted] });
    const run = await runCli([...argv, '--consent'], { commands: defs, context });
    expect(run.envelope?.error?.code).toBe('INVALID_INPUT');
    expect(run.envelope?.error?.message).toContain(message);
    expect(http.calls).toEqual([]);
  });

  it("says what the endpoint said when it refuses, and that nothing was filed", async () => {
    const refusal: Route = { method: 'POST', url: FEEDBACK_ENDPOINT, respond: { status: 429, json: { ok: false, error: 'This address has sent 3 reports today, the daily limit for /api/report. Try again tomorrow (UTC).' } } };
    const { context } = testContext({ routes: [refusal] });
    const run = await runCli([...args, '--consent'], { commands: defs, context });
    expect(run.envelope?.error).toMatchObject({ code: 'HTTP', message: 'The toil feedback endpoint refused the report: This address has sent 3 reports today, the daily limit for /api/report. Try again tomorrow (UTC).' });
    expect(run.envelope?.error?.fix).toContain('Nothing was filed');
    expect(run.envelope?.error?.fix).toContain(FEEDBACK_FORM);
  });

  it('refuses to send from a build that does not know its commit, but still previews, without asking first', async () => {
    const unknown = feedbackCommands(null);
    const asked = scriptedPrompter({ 'toil would send': 'yes' });
    const { context, http } = testContext({ routes: [accepted], prompt: asked.prompt });
    const preview = await runCli(args, { commands: unknown, context });
    expect((preview.envelope?.data as { sent: boolean; report: { commit: unknown } }).report.commit).toBeNull();
    expect(preview.envelope?.data).toMatchObject({ sent: false });
    expect(preview.envelope?.meta.warnings?.[0]?.message).toContain("this toil can't send it");
    expect(asked.asked).toEqual([]);
    const run = await runCli([...args, '--consent'], { commands: unknown, context });
    expect(run.envelope?.error?.code).toBe('UNSUPPORTED');
    expect(run.envelope?.error?.message).toContain('Nothing was sent');
    expect(http.calls).toEqual([]);
  });

  it('sends to a loopback TOIL_FEEDBACK_URL, for a local copy of the function, and refuses any other host', async () => {
    const local: Route = { method: 'POST', url: 'http://127.0.0.1:7071/api/report', respond: { status: 202, json: { ok: true, message: 'queued' } } };
    const ok = testContext({ routes: [local] });
    ok.context.env = { TOIL_FEEDBACK_URL: 'http://127.0.0.1:7071' };
    expect((await runCli([...args, '--consent'], { commands: defs, context: ok.context })).envelope?.data).toMatchObject({ sent: true, endpoint: 'http://127.0.0.1:7071/api/report' });

    for (const url of ['https://feedback.imagile.dev', 'http://127.0.0.1.imagile.dev:7071', 'http://user@127.0.0.1:7071', 'http://127.0.0.1:7071/elsewhere']) {
      const bad = testContext({ routes: [accepted] });
      bad.context.env = { TOIL_FEEDBACK_URL: url };
      const run = await runCli([...args, '--consent'], { commands: defs, context: bad.context });
      expect(run.envelope?.error?.code, url).toBe('CONFIG_INVALID');
      expect(bad.http.calls, url).toEqual([]);
    }
  });

  it('keeps the report out of the audit log: the title and body only as hashes, the email not at all', async () => {
    const { context, audit } = testContext({ routes: [accepted] });
    await runCli([...args, '--consent'], { commands: defs, context });
    const entries = audit.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ command: 'feedback' });
    const line = JSON.stringify(entries);
    expect(line).not.toContain('jira issue search ignores');
    expect(line).not.toContain('It returns 50');
    expect(line).not.toContain('you@example.com');
  });

  it('is CLI only: never an MCP tool', () => {
    const def = commands.find((c) => c.path.join(' ') === 'feedback')!;
    expect(def.kind).toBe('cli-only');
    expect(servedOverMcp(def)).toBe(false);
  });
});
