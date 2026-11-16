import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand } from '../src/core/command.js';
import { allowWriteField } from '../src/core/run.js';
import { commands } from '../src/registry.js';
import { demoArea, demoRoutes } from './fixtures/demo-commands.js';
import { testContext } from './harness/context.js';
import { connectMcp } from './harness/mcp.js';

// A tool result JSON can't hold must still come back as one envelope, as a
// tool error, never as a JSON-RPC protocol error (#647; the CLI half is #642).

const circular = () => {
  const value: Record<string, unknown> = { name: 'loop' };
  value['self'] = value;
  return value;
};

describe('MCP results that cannot be serialized', () => {
  it('answers a result nested past the stack with an INTERNAL tool error, not -32603', async () => {
    // A placeholder token whose payload nests far past the stringify cliff.
    const depth = 20_000;
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(`{"a":${'['.repeat(depth)}1${']'.repeat(depth)}}`).toString('base64url');
    const token = `${header}.${payload}.c2lnbmF0dXJlLW5vdC1jaGVja2Vk`;
    const mcp = await connectMcp({ commands, context: testContext().context, areas: ['util'] });
    try {
      const result = await mcp.call('util_jwt_decode', { token });
      expect(result.isError).toBe(true);
      expect(result.envelope).toMatchObject({
        ok: false,
        data: null,
        error: { code: 'INTERNAL', message: expect.stringContaining("couldn't be printed as JSON"), fix: expect.stringContaining('--select') },
        meta: { command: 'util jwt decode' },
      });
      expect(JSON.parse(result.text)).toEqual(result.envelope);
    } finally {
      await mcp.close();
    }
  });

  it('answers circular and BigInt results the same way', async () => {
    const readCircular = defineCommand({ path: ['read-circular'], description: 'read returning a circular result', input: z.object({}), writes: false, examples: [{}], run: async () => circular() });
    const readBigInt = defineCommand({ path: ['read-bigint'], description: 'read returning a BigInt', input: z.object({}), writes: false, examples: [{}], run: async () => ({ count: 10n }) });
    const mcp = await connectMcp({ commands: [readCircular, readBigInt], context: testContext().context });
    try {
      for (const name of ['read_circular', 'read_bigint']) {
        const result = await mcp.call(name, {});
        expect(result.isError, name).toBe(true);
        expect(result.envelope, name).toMatchObject({ ok: false, data: null, error: { code: 'INTERNAL', message: expect.stringContaining("couldn't be printed as JSON") } });
        expect(JSON.parse(result.text), name).toEqual(result.envelope);
      }
    } finally {
      await mcp.close();
    }
  });

  it('says a write may already have been applied when the command writes', async () => {
    const writeCircular = demoArea.command({ path: ['demo', 'write-circular'], description: 'write returning a circular result', input: z.object({ ...allowWriteField }), writes: true, examples: [{ allowWrite: true }], run: async () => circular() });
    const { context } = testContext({ config: { demo: { token: 't', writes: true } }, routes: demoRoutes });
    const mcp = await connectMcp({ commands: [writeCircular], context });
    try {
      const result = await mcp.call('demo_write_circular', { allowWrite: true });
      expect(result.isError).toBe(true);
      expect(result.envelope).toMatchObject({
        ok: false,
        data: null,
        error: { code: 'INTERNAL', message: expect.stringContaining('may already have been applied'), fix: expect.stringContaining('Check whether the change was made before retrying') },
        meta: { command: 'demo write-circular' },
      });
    } finally {
      await mcp.close();
    }
  });
});
