import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testContext } from '../../test/harness/context.js';
import { defineArea } from './area.js';
import type { AnyCommand } from './command.js';
import { allowWriteField, execute } from './run.js';

/**
 * area.byDeployment(): one command per path from an implementation per deployment.
 * The widget area has a Data Center and a Cloud, as jira does, small enough
 * to see every rule: the union input, the dispatch, the refusals, and the
 * ways a definition can be inconsistent.
 */

const widget = defineArea({
  name: 'widget',
  description: 'test',
  connection: z.object({ baseUrl: z.url(), deployment: z.enum(['server', 'cloud']).default('server') }),
  defaults: { deployment: 'server' },
  variants: { by: 'deployment', of: { server: { label: 'Data Center' }, cloud: { label: 'Cloud' } } },
});

const get = (deployment: string, extra: Record<string, z.ZodType> = {}, description = 'Get a widget') =>
  widget.command({
    path: ['widget', 'get'],
    description,
    input: z.object({ id: z.string().describe('The id'), ...extra }),
    writes: false,
    args: [{ name: 'id', field: 'id', description: 'The id', required: true }],
    options: Object.entries(extra).map(([field, schema]) => ({ flags: `--${field.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} <value>`, field, description: schema.description ?? field })),
    examples: [{ id: '1' }],
    run: async (input, ctx) => ({ ran: deployment, input, connection: ctx.connection!.name }),
  });

const connection = (name: string, deployment: string) => ({ [name]: { area: 'widget', baseUrl: `https://${name}.imagile.dev`, deployment, writes: true } });
const config = { ...connection('widget', 'server'), ...connection('widget-cloud', 'cloud') };
const run = (def: AnyCommand, input: Record<string, unknown>, via: 'cli' | 'mcp' = 'cli', cfg: Record<string, Record<string, unknown>> = config) => execute(def, input, testContext({ config: cfg }).context, via);

describe('area.byDeployment', () => {
  const [both] = widget.byDeployment({
    server: [get('server', { startAt: z.number().optional().describe('Offset') })],
    cloud: [get('cloud', { cursor: z.string().optional().describe('Cursor') })],
  });

  it('registers one command with the union of both inputs, every example tagged with its deployment', () => {
    expect(Object.keys(both!.input.shape)).toEqual(expect.arrayContaining(['id', 'startAt', 'cursor', 'connection']));
    expect(both!.input.shape.startAt!.description).toBe('Offset [Data Center only]');
    expect(both!.input.shape.cursor!.description).toBe('Cursor [Cloud only]');
    expect(both!.examples).toHaveLength(2);
    expect(both!.exampleDeployments).toEqual(['server', 'cloud']);
    expect(both!.options!.map((o) => o.field)).toEqual(expect.arrayContaining(['startAt', 'cursor']));
  });

  it("runs the implementation of the resolved connection's deployment, and says which in meta.context", async () => {
    const server = await run(both!, { id: '1' });
    expect(server.data).toMatchObject({ ran: 'server', connection: 'widget' });
    expect(server.meta.context?.connection).toMatchObject({ value: 'widget', source: 'default', deployment: 'server' });
    const cloud = await run(both!, { id: '1', connection: 'widget-cloud' });
    expect(cloud.data).toMatchObject({ ran: 'cloud', connection: 'widget-cloud' });
    expect(cloud.meta.context?.connection).toMatchObject({ value: 'widget-cloud', deployment: 'cloud' });
  });

  it('refuses a flag only the other deployment takes before running, naming the flag on the CLI and the field over MCP', async () => {
    const cli = await run(both!, { id: '1', startAt: 5, connection: 'widget-cloud' });
    expect(cli.error).toMatchObject({ code: 'UNSUPPORTED', message: expect.stringContaining('--start-at isn\'t available on Cloud connections') });
    expect(cli.error?.fix).toContain('--connection widget');
    const mcp = await run(both!, { id: '1', startAt: 5, connection: 'widget-cloud' }, 'mcp');
    expect(mcp.error?.message).toContain('startAt isn\'t available on Cloud connections');
    expect(cli.data).toBeNull();
    // The same field on its own deployment runs.
    expect((await run(both!, { id: '1', startAt: 5 })).data).toMatchObject({ ran: 'server' });
  });

  it("refuses a command the deployment has none of, naming the connections that can", async () => {
    const [onlyServer] = widget.byDeployment({ server: [get('server')] });
    const refused = await run(onlyServer!, { id: '1', connection: 'widget-cloud' });
    expect(refused.error).toMatchObject({ code: 'UNSUPPORTED', message: 'widget get isn\'t available on Cloud connections, and connection widget-cloud is one. It works on Data Center.', fix: 'Use a Data Center connection (--connection widget).' });
  });

  it('refuses before the write gate, so a missing command is not reported as a missing opt-in', async () => {
    const write = widget.command({ path: ['widget', 'make'], description: 'Make', input: z.object({ ...allowWriteField }), writes: true, examples: [{ allowWrite: true }], run: async () => 'made' });
    const [onlyServer] = widget.byDeployment({ server: [write] });
    const off = { widget: { area: 'widget', baseUrl: 'https://widget.imagile.dev' }, 'widget-cloud': { area: 'widget', baseUrl: 'https://c.imagile.dev', deployment: 'cloud' } };
    expect((await run(onlyServer!, { connection: 'widget-cloud' }, 'cli', off)).error?.code).toBe('UNSUPPORTED');
    expect((await run(onlyServer!, { allowWrite: true }, 'cli', off)).error?.code).toBe('WRITE_DISABLED');
  });

  it("holds each deployment to its own input schema: a stricter field is checked for its calls only", async () => {
    const [strict] = widget.byDeployment({
      server: [get('server', { limit: z.union([z.number(), z.string()]).optional() })],
      cloud: [get('cloud', { limit: z.number().int().positive().optional() })],
    });
    expect((await run(strict!, { id: '1', limit: '5x' })).data).toMatchObject({ ran: 'server' });
    expect((await run(strict!, { id: '1', limit: '5', connection: 'widget-cloud' })).data).toMatchObject({ ran: 'cloud', input: { limit: 5 } });
    const bad = await run(strict!, { id: '1', limit: '5x', connection: 'widget-cloud' });
    expect(bad.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('Invalid input for widget get') });
  });

  it('makes a field optional in the union when one deployment does not require it, and the one that does still requires it', async () => {
    const needs = (deployment: string, field: z.ZodType) => widget.command({ path: ['widget', 'log'], description: 'Log', input: z.object({ at: field }), writes: false, examples: [{ at: 'now' }], run: async () => deployment });
    const [log] = widget.byDeployment({ server: [needs('server', z.string().optional())], cloud: [needs('cloud', z.string())] }, { overrides: {} });
    expect((await run(log!, {})).data).toBe('server');
    expect((await run(log!, { connection: 'widget-cloud' })).error?.code).toBe('INVALID_INPUT');
  });
});

describe('area.byDeployment definition checks', () => {
  const two = (server: AnyCommand, cloud: AnyCommand) => () => widget.byDeployment({ server: [server], cloud: [cloud] });

  it('throws when the deployments disagree about writing, or describe a command or a field differently without saying how', () => {
    const w = widget.command({ path: ['widget', 'get'], description: 'Get a widget', input: z.object({ ...allowWriteField }), writes: true, examples: [{ allowWrite: true }], run: async () => 1 });
    expect(two(get('server'), w)).toThrow(/writes is true for Cloud but false for Data Center/);
    expect(two(get('server'), get('cloud', {}, 'Get a Cloud widget'))).toThrow(/description differs/);
    const described = (text: string) => widget.command({ path: ['widget', 'get'], description: 'Get', input: z.object({ id: z.string().describe(text) }), writes: false, examples: [{ id: '1' }], run: async () => 1 });
    expect(two(described('Id'), described('Account id'))).toThrow(/field id is described differently/);
    expect(() => widget.byDeployment({ server: [described('Id')], cloud: [described('Account id')] }, { overrides: { 'widget get': { describe: { id: 'Id (an account id on Cloud)' } } } })).not.toThrow();
  });

  it('throws for a command with no connection, which has nothing to route by', () => {
    const local = widget.command({ path: ['widget', 'schema'], kind: 'area-local', description: 'Schema', input: z.object({}), writes: false, examples: [{}], run: async () => 1 });
    expect(() => widget.byDeployment({ server: [local] })).toThrow(/kind area-local/);
  });

  it('throws for a deployment the area has no variant for, and for an area with no variants', () => {
    expect(() => widget.byDeployment({ edge: [get('edge')] })).toThrow(/deployment "edge"/);
    const plain = defineArea({ name: 'plain', description: 'test', connection: z.object({}) });
    expect(() => plain.byDeployment({ server: [] })).toThrow(/declare variants/);
  });
});
