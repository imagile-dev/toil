import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testContext } from '../../test/harness/context.js';
import { defineCommand } from './command.js';
import { CONTRACT_VERSION } from './envelope.js';
import { ToilError } from './errors.js';
import { execute } from './run.js';

const make = (run: () => Promise<unknown>) =>
  defineCommand({ path: ['test', 'cmd'], description: 'test', input: z.object({}), writes: false, examples: [{}], run });

describe('execute', () => {
  it('wraps data in a success envelope with meta', async () => {
    const { context } = testContext();
    const envelope = await execute(make(async () => ({ a: 1 })), {}, context);
    expect(envelope).toEqual({ ok: true, data: { a: 1 }, error: null, meta: { command: 'test cmd', durationMs: expect.any(Number), version: context.version, contractVersion: CONTRACT_VERSION } });
  });

  it('passes a ToilError through with its code and fix', async () => {
    const { context } = testContext();
    const envelope = await execute(make(async () => { throw new ToilError('AUTH', 'Token rejected.', { fix: 'Regenerate it.' }); }), {}, context);
    expect(envelope).toMatchObject({ ok: false, data: null, error: { code: 'AUTH', message: 'Token rejected.', fix: 'Regenerate it.' } });
  });

  it('wraps anything else as INTERNAL, without a stack trace', async () => {
    const { context } = testContext();
    const envelope = await execute(make(async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); }), {}, context);
    expect(envelope.error).toMatchObject({ code: 'INTERNAL', fix: expect.stringContaining('issues') });
    expect(JSON.stringify(envelope)).not.toContain('    at ');
  });
});
