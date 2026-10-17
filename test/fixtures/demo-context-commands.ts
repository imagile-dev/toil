import { z } from 'zod';
import { defineArea } from '../../src/core/area.js';
import type { AnyCommand } from '../../src/core/command.js';
import { ToilError } from '../../src/core/errors.js';
import { demoArea } from './demo-commands.js';

/**
 * A test-only area for the kit's area API: context inputs at group and
 * command level (one read from the git remote, one that selects the
 * connection), a token shared from the `demo` area's connection, a
 * cross-group alias, and every input type the CLI has to turn from text.
 * Never registered in the shipped CLI. It exists so the parity suite proves
 * the paperwork is filed identically at both windows.
 */
export const demoContextArea = defineArea({
  name: 'demo-context',
  description: 'A fake API with context inputs, for the test harness',
  connection: z.object({
    baseUrl: z.url().describe('API base URL'),
    token: z.string().min(1).optional().describe("Bearer token; the demo connection's token when unset"),
    project: z.string().min(1).optional().describe('Default project key'),
    env: z.string().min(1).optional().describe('The environment this connection serves'),
  }),
  secrets: ['token'],
  defaults: { baseUrl: 'https://demo.imagile.dev' },
  context: {
    project: {
      description: 'Project key',
      flags: '--project <key>',
      setting: 'project',
      schema: z.string().regex(/^[A-Z][A-Z0-9]*$/, 'a project key is upper-case letters and digits'),
      // https://demo.imagile.dev/scm/PRJ/repo.git -> PRJ
      git: (remote) => /\/scm\/([^/]+)\/[^/]+$/.exec(remote.url)?.[1],
    },
    env: { description: 'Environment; selects the connection that serves it', flags: '--env <name>', selectsConnection: true },
    board: { description: 'Board name', flags: '--board <name>', scope: 'command', default: 'main' },
  },
});

const sharedToken = { area: demoArea, keys: ['token'] };

export const getWidget = demoContextArea.command({
  path: ['demo-context', 'get-widget'],
  description: 'Get a widget in a project',
  input: z.object({ id: z.string().min(1).describe('Widget id') }),
  writes: false,
  context: { project: 'required', board: 'optional' },
  shares: sharedToken,
  aliases: [['demo', 'widget'], 'widget'],
  args: [{ name: 'id', field: 'id', description: 'Widget id' }],
  examples: [{ id: 'W-1' }, { id: 'W-2', project: 'OTHER', board: 'ops', env: 'staging' }],
  run: async (input, ctx) => {
    const token = ctx.connection.token;
    if (!token) throw new ToilError('NOT_CONFIGURED', 'No token.', { fix: `Set ${demoContextArea.envName('token')} or ${demoArea.envName('token')}.` });
    const url = new URL(`/api/projects/${ctx.context.project!}/widgets/${encodeURIComponent(input.id)}`, ctx.connection.baseUrl);
    url.searchParams.set('board', ctx.context.board!);
    const res = await ctx.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      // The kibana pattern: say which connection's key was sent.
      const from = ctx.resolved.shared?.token;
      throw new ToilError('AUTH', `The token was rejected${from ? ` (sent the shared token from ${from.area} connection ${from.connection})` : ''}.`, {
        fix: `Set ${demoContextArea.envName('token')} to a token this API accepts.`,
      });
    }
    const body = (await res.json()) as { id: string; name: string };
    return { project: ctx.context.project, board: ctx.context.board, env: ctx.context.env ?? null, id: body.id, name: body.name };
  },
});

export const echoFilters = demoContextArea.command({
  path: ['demo-context', 'echo-filters'],
  description: 'Echo typed filters back, to check how argv becomes typed input',
  input: z.object({
    limit: z.number().int().optional().describe('A number'),
    archived: z.boolean().optional().describe('A boolean flag with no value'),
    strict: z.boolean().optional().describe('A boolean flag that takes true or false'),
    sort: z.enum(['name', 'created']).optional().describe('An enum'),
    ids: z.array(z.number().int()).optional().describe('A repeatable flag of numbers'),
    filter: z.object({ owner: z.string(), open: z.boolean() }).optional().describe('A JSON object'),
    label: z.union([z.number(), z.string()]).optional().describe('A union: stays text from argv'),
  }),
  writes: false,
  options: [
    { flags: '--limit <n>', field: 'limit', description: 'A number' },
    { flags: '--archived', field: 'archived', description: 'A boolean flag' },
    { flags: '--strict <bool>', field: 'strict', description: 'true or false' },
    { flags: '--sort <field>', field: 'sort', description: 'name or created' },
    { flags: '--id <n>', field: 'ids', description: 'Repeatable' },
    { flags: '--filter <json>', field: 'filter', description: 'JSON object' },
    { flags: '--label <text>', field: 'label', description: 'Number or text' },
  ],
  examples: [
    { limit: 5, archived: true, strict: false, sort: 'created', ids: [1, 2], filter: { owner: 'you', open: true }, label: '7' },
    { project: 'PRJ', env: 'staging' },
  ],
  run: async (input, ctx) => ({ input, context: ctx.context }),
});

export const demoContextCommands: AnyCommand[] = [getWidget, echoFilters];

export const demoContextRoutes = [
  {
    url: /^https:\/\/demo\.imagile\.dev\/api\/projects\/[A-Z0-9]+\/widgets\/W-\d+\?board=\w+$/,
    respond: (req: { url: string }) => {
      const id = new URL(req.url).pathname.split('/').pop()!;
      return { json: { id, name: `Widget ${id}` } };
    },
  },
];
