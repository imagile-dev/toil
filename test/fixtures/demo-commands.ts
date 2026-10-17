import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../../src/core/command.js';
import { setting } from '../../src/core/config.js';
import { ToilError } from '../../src/core/errors.js';
import { allowWriteField } from '../../src/core/run.js';

/**
 * Test-only commands shaped like a real integration: one read and one write
 * against an HTTP API, so the harness and the parity test exercise positional
 * args, flags, auth headers, response reshaping and the write gate before any
 * real integration exists. Never registered in the shipped CLI.
 */
const BASE = 'https://demo.imagile.dev';

function auth(token: unknown): Record<string, string> {
  if (typeof token !== 'string' || token === '') {
    throw new ToilError('NOT_CONFIGURED', 'demo.token is not set.', { fix: 'Set TOIL_DEMO_TOKEN.' });
  }
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

export const getThing = defineCommand({
  path: ['demo', 'get-thing'],
  description: 'Get a thing by id',
  input: z.object({
    id: z.string().min(1).describe('Thing id, e.g. THING-1'),
    fields: z.string().optional().describe('Comma-separated fields to return'),
  }),
  writes: false,
  options: [
    { flags: '--id <id>', field: 'id', description: 'Thing id' },
    { flags: '--fields <list>', field: 'fields', description: 'Fields to return' },
  ],
  examples: [{ id: 'THING-1' }, { id: 'THING-2', fields: 'name,owner' }],
  run: async (input, ctx) => {
    const url = new URL(`/api/things/${encodeURIComponent(input.id)}`, BASE);
    if (input.fields) url.searchParams.set('fields', input.fields);
    const res = await ctx.fetch(url, { headers: auth(setting(ctx.config, 'demo', 'token')) });
    if (res.status === 404) throw new ToilError('NOT_FOUND', `No thing ${input.id}.`, { fix: 'Check the id.' });
    const body = (await res.json()) as { id: string; attributes: { name: string; owner?: { login: string } } };
    return { id: body.id, name: body.attributes.name, owner: body.attributes.owner?.login ?? null };
  },
});

export const renameThing = defineCommand({
  path: ['demo', 'rename-thing'],
  description: 'Rename a thing',
  input: z.object({
    id: z.string().min(1).describe('Thing id'),
    name: z.string().min(1).describe('New name'),
    ...allowWriteField,
  }),
  writes: true,
  dryRun: 'fetch',
  args: [{ name: 'id', field: 'id', description: 'Thing id' }],
  options: [{ flags: '--name <name>', field: 'name', description: 'New name' }],
  examples: [{ id: 'THING-1', name: 'Renamed', allowWrite: true }],
  run: async (input, ctx) => {
    const res = await ctx.fetch(new URL(`/api/things/${encodeURIComponent(input.id)}`, BASE), {
      method: 'PUT',
      headers: { ...auth(setting(ctx.config, 'demo', 'token')), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name }),
    });
    const body = (await res.json()) as { id: string; attributes: { name: string } };
    return { id: body.id, name: body.attributes.name };
  },
});

export const demoCommands: AnyCommand[] = [getThing, renameThing];

/** Canned responses for the demo API, matching the requests the commands send. */
export const demoRoutes = [
  {
    url: /^https:\/\/demo\.imagile\.dev\/api\/things\/THING-\d+(\?.*)?$/,
    respond: (req: { url: string }) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      return { json: { id, attributes: { name: `Thing ${id}`, owner: { login: 'you' } } } };
    },
  },
  {
    method: 'PUT',
    url: /^https:\/\/demo\.imagile\.dev\/api\/things\/THING-\d+$/,
    respond: (req: { url: string; body: string | undefined }) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      const { name } = JSON.parse(req.body ?? '{}') as { name: string };
      return { json: { id, attributes: { name } } };
    },
  },
];
