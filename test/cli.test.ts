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

  it('exits 1 with help on an unknown command', async () => {
    const { context } = testContext();
    const run = await runCli(['nope'], { commands, context });
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("unknown command 'nope'");
  });

  it('returns INVALID_INPUT with a fix when a required field is missing', async () => {
    const { context, http } = testContext({ config: { demo: { token: 't' } }, routes: demoRoutes });
    const run = await runCli(['demo', 'get-thing'], { commands: demoCommands, context });
    expect(run.exitCode).toBe(1);
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', fix: expect.stringContaining('--help') });
    expect(http.calls).toHaveLength(0);
  });
});
