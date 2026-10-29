import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { commands } from '../src/registry.js';
import { skillPages } from '../src/skill-pages.generated.js';
import { demoCommands } from './fixtures/demo-commands.js';
import { testContext } from './harness/context.js';
import { dossierDisk } from './harness/dossiers.js';
import { connectMcp, type McpSession } from './harness/mcp.js';

/**
 * The resources `toil mcp` serves beside its tools, read through a real MCP
 * client: connections without a secret, the dossiers as the dossiers tools
 * return them, and the skill's page per area, all scoped by --areas.
 */

const disk = dossierDisk({
  'home/.toil/dossiers/payments.json': { name: 'payments', description: 'Payments platform', jira: { project: 'PAY' } },
});
afterAll(() => disk.cleanup());

const sessions: McpSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

const TOKEN = 'jira-t0ken-abc12345';
const config = { jira: { baseUrl: 'https://jira.imagile.dev', token: TOKEN, writes: true }, demo: { baseUrl: 'https://demo.imagile.dev', token: 'demo-t0ken' } };

async function session(areas?: string[]) {
  const { context, audit } = testContext({ config, dossiers: disk.catalog });
  const s = await connectMcp({ commands: [...commands, ...demoCommands], context, ...(areas ? { areas } : {}) });
  sessions.push(s);
  return { client: s.client, audit };
}

const text = (result: { contents: ReadonlyArray<object> }) => String((result.contents[0] as { text?: unknown } | undefined)?.text);

describe('MCP resources', () => {
  it('lists connections, the dossiers, each dossier and a skill page per area served', async () => {
    const { client } = await session();
    const uris = (await client.listResources()).resources.map((r) => r.uri);
    expect(uris).toEqual(expect.arrayContaining(['toil://connections', 'toil://dossiers', 'toil://dossiers/payments', 'toil://skill/jira']));
    expect(uris).not.toContain('toil://skill/confluence');
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
    expect(templates).toEqual(['toil://dossiers/{name}']);
  });

  it('toil://connections has names, areas, default and writes, and never a host or a secret', async () => {
    const { client } = await session();
    const body = text(await client.readResource({ uri: 'toil://connections' }));
    expect(JSON.parse(body)).toEqual({
      connections: [
        { name: 'demo', area: 'demo', isDefault: true, writes: false },
        { name: 'jira', area: 'jira', isDefault: true, writes: true },
      ],
    });
    expect(body).not.toContain(TOKEN);
    expect(body).not.toContain('imagile.dev');
  });

  it('toil://dossiers and toil://dossiers/<name> are what the dossiers tools return', async () => {
    const { client } = await session();
    const list = JSON.parse(text(await client.readResource({ uri: 'toil://dossiers' }))) as { dossiers: Array<{ name: string }> };
    expect(list.dossiers.map((d) => d.name)).toEqual(['payments']);
    const viaTool = (await client.callTool({ name: 'dossiers_show', arguments: { dossier: 'payments' } })).structuredContent as { data: unknown };
    expect(JSON.parse(text(await client.readResource({ uri: 'toil://dossiers/payments' })))).toEqual(viaTool.data);
    await expect(client.readResource({ uri: 'toil://dossiers/nope' })).rejects.toThrow(/nope/);
  });

  it('refuses anything but a dossier name in toil://dossiers/<name>, before the dossiers command runs', async () => {
    const { client, audit } = await session();
    const before = audit.lines.length;
    // Paths in any case or spelling, and names that break the dossier-name rule.
    for (const name of ['..%2Fsecrets.json', 'x.JSON', 'x.json', 'payments.Json', '%2Fetc%2Fpasswd', 'C%3A%5Cdossier.json', '..', '.', 'Payments', 'pay--ments', 'pay_ments', '-pay', '9pay', 'pay%20ments', '%E0%A4%A', '']) {
      await expect(client.readResource({ uri: `toil://dossiers/${name}` }), name).rejects.toThrow(/doesn't name a dossier/);
    }
    // Nothing ran: dossiers show would have written an audit line.
    expect(audit.lines).toHaveLength(before);
  });

  it("toil://skill/<area> is the distributed skill's page", async () => {
    const { client } = await session();
    const result = await client.readResource({ uri: 'toil://skill/jira' });
    expect(result.contents[0]).toMatchObject({ mimeType: 'text/markdown', text: skillPages.jira });
    expect(text(result)).toContain('toil jira');
  });

  it('follows --areas: only those areas, and no dossiers unless their tools are served', async () => {
    const { client } = await session(['jira']);
    const uris = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      'toil://connections',
      'toil://skill/changelog',
      'toil://skill/jira',
      'toil://skill/upgrading',
      'toil://skill/workflows/README',
      'toil://skill/workflows/map-codebase',
      'toil://skill/workflows/review',
      'toil://skill/workflows/ship',
    ]);
    // A workflow page spans areas, so it is served whatever --areas says.
    expect(text(await client.readResource({ uri: 'toil://skill/workflows/review' }))).toBe(skillPages['workflows/review']);
    expect(JSON.parse(text(await client.readResource({ uri: 'toil://connections' })))).toEqual({ connections: [{ name: 'jira', area: 'jira', isDefault: true, writes: true }] });
    expect(text(await client.readResource({ uri: 'toil://skill/upgrading' }))).toBe(skillPages.upgrading);
    expect(text(await client.readResource({ uri: 'toil://skill/changelog' }))).toContain('# toil changelog');
    await expect(client.readResource({ uri: 'toil://skill/demo' })).rejects.toThrow(/no resource/);
    await expect(client.readResource({ uri: 'toil://dossiers' })).rejects.toThrow(/no resource/);
    expect((await client.listResourceTemplates()).resourceTemplates).toEqual([]);
  });

  it('reads no service: no request is sent for any resource', async () => {
    const { context, http } = testContext({ config, dossiers: disk.catalog });
    const s = await connectMcp({ commands, context });
    sessions.push(s);
    for (const r of (await s.client.listResources()).resources) await s.client.readResource({ uri: r.uri });
    expect(http.calls).toEqual([]);
  });
});
