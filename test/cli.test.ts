import { describe, expect, it } from 'vitest';
import { commands } from '../src/registry.js';
import { demoCommands, demoRoutes } from './fixtures/demo-commands.js';
import { runCli } from './harness/cli.js';
import { TEST_VERSION, testContext } from './harness/context.js';

describe('toil CLI', () => {
  it('prints one compact JSON envelope per command', async () => {
    const { context } = testContext();
    const run = await runCli(['version'], { commands, context });
    expect(run.exitCode).toBe(0);
    expect(run.stdout.trim().split('\n')).toHaveLength(1);
    expect(run.envelope).toMatchObject({ ok: true, error: null, data: { version: TEST_VERSION }, meta: { command: 'version', version: TEST_VERSION } });
  });

  it('indents with --pretty', async () => {
    const { context } = testContext();
    const run = await runCli(['--pretty', 'version'], { commands, context });
    expect(run.stdout).toContain('\n  "ok": true');
  });

  it('writes to --output-file instead of stdout', async () => {
    const { context } = testContext();
    const run = await runCli(['--output-file', 'out.json', 'version'], { commands, context });
    expect(run.stdout).toBe('');
    expect(JSON.parse(run.files['out.json']!)).toMatchObject({ ok: true });
  });

  it('prints the bare version for -v', async () => {
    const { context } = testContext();
    const run = await runCli(['-v'], { commands, context });
    expect(run.stdout.trim()).toBe(TEST_VERSION);
    expect(run.exitCode).toBe(0);
  });

  it('answers an unknown command with an INVALID_INPUT envelope on stdout', async () => {
    const { context } = testContext();
    const run = await runCli(['nope'], { commands, context });
    expect(run.exitCode).toBe(1);
    expect(run.envelope).toMatchObject({ ok: false, data: null, error: { code: 'INVALID_INPUT', message: expect.stringContaining('nope') } });
    expect(run.stderr).toContain("unknown command 'nope'");
  });

  it('answers an unknown flag with an envelope, honouring --pretty', async () => {
    const { context } = testContext();
    const run = await runCli(['--pretty', 'version', '--bogus'], { commands, context });
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain('\n  "ok": false');
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('--help') });
  });

  it('answers a missing argument with an envelope written to --output-file', async () => {
    const { context } = testContext({ config: { demo: { token: 't', writes: true } } });
    const run = await runCli(['--output-file', 'err.json', 'demo', 'rename-thing'], { commands: demoCommands, context });
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toBe('');
    expect(JSON.parse(run.files['err.json']!)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' }, meta: { command: 'demo rename-thing' } });
  });

  it('still prints plain help, not an envelope, for --help', async () => {
    const { context } = testContext();
    const run = await runCli(['--help'], { commands, context });
    expect(run.exitCode).toBe(0);
    expect(run.envelope).toBeUndefined();
    expect(run.stdout).toContain('Usage: toil');
  });

  it('returns INVALID_INPUT with a fix when a required field is missing', async () => {
    const { context, http } = testContext({ config: { demo: { token: 't' } }, routes: demoRoutes });
    const run = await runCli(['demo', 'get-thing'], { commands: demoCommands, context });
    expect(run.exitCode).toBe(1);
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('--help') });
    expect(http.calls).toHaveLength(0);
  });
});
