import { z } from 'zod';
import { defineArea } from '../../src/core/area.js';
import type { AnyCommand } from '../../src/core/command.js';
import { ToilError } from '../../src/core/errors.js';
import { allowWriteField } from '../../src/core/run.js';

/**
 * Test-only commands shaped like a real integration: one read and one write
 * against an HTTP API, so the harness and the parity test exercise positional
 * args, flags, auth headers, response reshaping and the write gate before any
 * real integration exists. Never registered in the shipped CLI.
 */
export const demoArea = defineArea({
  name: 'demo',
  description: 'A fake API for the test harness',
  connection: z.object({
    baseUrl: z.url().describe('API base URL'),
    token: z.string().min(1).describe('Bearer token'),
    pageSize: z.number().int().positive().optional().describe('Results per page'),
  }),
  secrets: ['token'],
  // A real area never defaults its host (every host is user-supplied); the
  // demo does, so tests stay short. It also exercises provider defaults.
  defaults: { baseUrl: 'https://demo.imagile.dev' },
  renamed: { apiToken: 'token' },
});

const auth = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}`, Accept: 'application/json' });

export const getThing = demoArea.command({
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
    const url = new URL(`/api/things/${encodeURIComponent(input.id)}`, ctx.connection.baseUrl);
    if (input.fields) url.searchParams.set('fields', input.fields);
    const res = await ctx.fetch(url, { headers: auth(ctx.connection.token) });
    if (res.status === 404) throw new ToilError('NOT_FOUND', `No thing ${input.id}.`, { fix: 'Check the id.' });
    const body = (await res.json()) as { id: string; attributes: { name: string; owner?: { login: string } } };
    return { id: body.id, name: body.attributes.name, owner: body.attributes.owner?.login ?? null };
  },
});

export const renameThing = demoArea.command({
  path: ['demo', 'rename-thing'],
  description: 'Rename a thing',
  input: z.object({
    id: z.string().min(1).describe('Thing id'),
    name: z.string().min(1).describe('New name'),
    ...allowWriteField,
  }),
  writes: true,
  args: [{ name: 'id', field: 'id', description: 'Thing id' }],
  options: [{ flags: '--name <name>', field: 'name', description: 'New name' }],
  examples: [{ id: 'THING-1', name: 'Renamed', allowWrite: true }],
  run: async (input, ctx) => {
    const res = await ctx.fetch(new URL(`/api/things/${encodeURIComponent(input.id)}`, ctx.connection.baseUrl), {
      method: 'PUT',
      headers: { ...auth(ctx.connection.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.name }),
    });
    const body = (await res.json()) as { id: string; attributes: { name: string } };
    return { id: body.id, name: body.attributes.name };
  },
});

/** A delete: on the CLI with its connection and the write gate, never an MCP tool. */
export const deleteThing = demoArea.command({
  path: ['demo', 'delete-thing'],
  description: 'Delete a thing',
  input: z.object({ id: z.string().min(1).describe('Thing id'), ...allowWriteField }),
  writes: true,
  mcp: false,
  args: [{ name: 'id', field: 'id', description: 'Thing id' }],
  examples: [{ id: 'THING-1', allowWrite: true }],
  run: async (input, ctx) => {
    await ctx.fetch(new URL(`/api/things/${encodeURIComponent(input.id)}`, ctx.connection.baseUrl), { method: 'DELETE', headers: auth(ctx.connection.token) });
    return { deleted: input.id };
  },
});

/**
 * Answers for itself when demo isn't set up, with a success that says so;
 * with a connection, it reads the API.
 */
export const thingStatus = demoArea.command({
  path: ['demo', 'status'],
  description: 'Say whether demo is set up, and if so read its status',
  input: z.object({}),
  writes: false,
  connectionOptional: true,
  examples: [{}],
  run: async (_input, ctx) => {
    if (!ctx.connection) return { configured: false, message: 'demo is not configured.' };
    const res = await ctx.fetch(new URL('/api/things/THING-0', ctx.connection.baseUrl), { headers: auth(ctx.connection.token) });
    const body = (await res.json()) as { id: string };
    return { configured: true, id: body.id };
  },
});

export const demoCommands: AnyCommand[] = [getThing, renameThing, deleteThing, thingStatus];

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
    method: 'DELETE',
    url: /^https:\/\/demo\.imagile\.dev\/api\/things\/THING-\d+$/,
    respond: () => ({ status: 204 }),
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
