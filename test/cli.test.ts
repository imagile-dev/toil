import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../src/core/command.js';
import { argvFor } from '../src/program.js';
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

  it('honours --output-file=path on a usage error too', async () => {
    const { context } = testContext();
    const run = await runCli(['--output-file=err.json', 'nope'], { commands, context });
    expect(run.stdout).toBe('');
    expect(JSON.parse(run.files['err.json']!)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' }, meta: { command: 'nope' } });
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

  describe('argv to typed input', () => {
    const echo = defineCommand({
      path: ['echo'],
      description: 'echo',
      input: z.object({ n: z.number().int().optional(), tags: z.array(z.string()).optional(), name: z.string().optional() }),
      writes: false,
      options: [
        { flags: '--n <n>', field: 'n', description: 'a number' },
        { flags: '--tag <tag>', field: 'tags', description: 'repeatable' },
        { flags: '--name <name>', field: 'name', description: 'text that looks numeric' },
      ],
      examples: [{}],
      run: async (input) => input,
    });

    it('turns a numeric flag into a number and collects a repeated flag for an array field', async () => {
      const { context } = testContext();
      const run = await runCli(['echo', '--n', '50', '--tag', 'a=1', '--tag', 'b=2,3', '--name', '007'], { commands: [echo], context });
      expect(run.envelope?.data).toEqual({ n: 50, tags: ['a=1', 'b=2,3'], name: '007' });
    });

    it('leaves a non-numeric value for the schema to refuse', async () => {
      const { context } = testContext();
      const run = await runCli(['echo', '--n', 'ten'], { commands: [echo], context });
      expect(run.envelope?.error?.code).toBe('INVALID_INPUT');
    });

    it('argvFor repeats a flag per array item', () => {
      expect(argvFor(echo, { n: 5, tags: ['x', 'y'] })).toEqual(['echo', '--n', '5', '--tag', 'x', '--tag', 'y']);
    });
  });
});
