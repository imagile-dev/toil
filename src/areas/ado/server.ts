import { z } from 'zod';
import { adoArea } from './area.js';
import { API, API_CONNECTION, adoAll, ado, enc, where, type AdoContext } from './client.js';

/**
 * The server-level reads: who the token belongs to, the collections, and the
 * team projects in one. Each still asks for a collection and a project before
 * it starts (#69 item 2), the way a visitor badge needs a host to sign for it
 * even in the lobby.
 */

const AT = { collection: 'DefaultCollection', organization: 'DefaultCollection', project: 'Imagile', repo: 'imagile-api' };

/** `connectionData` for the collection: the authenticated user, the instance id and the deployment. */
export function connectionData(ctx: AdoContext, collection: string): Promise<{ authenticatedUser: { id: string } }> {
  return ado(ctx, `/${enc(collection)}/_apis/connectionData?api-version=${API_CONNECTION}`);
}

export const whoamiCommand = adoArea.command({
  path: ['ado', 'whoami'],
  description: 'Show current authenticated user',
  toolDescription: "Returns the server's connectionData for the collection: the authenticated user (id, display name), the instance and the deployment. Same output as ado_connection_data.",
  input: z.object({}),
  writes: false,
  examples: [AT],
  run: async (_input, ctx) => connectionData(ctx, where(ctx).collection),
});

export const connectionDataCommand = adoArea.command({
  path: ['ado', 'connection-data'],
  description: 'Show raw connection data from the ADO server',
  toolDescription: "Returns the server's raw connectionData for the collection, exactly as ado_whoami does.",
  input: z.object({}),
  writes: false,
  examples: [AT],
  run: async (_input, ctx) => connectionData(ctx, where(ctx).collection),
});

export const projectListCollectionsCommand = adoArea.command({
  path: ['ado', 'project', 'list-collections'],
  description: 'List all project collections on the server',
  toolDescription: 'Lists the project collections on the server (id, name, url, state). Still needs a collection and project to be resolvable.',
  input: z.object({}),
  writes: false,
  examples: [AT],
  run: async (_input, ctx) => {
    where(ctx);
    const result = await ado<{ value?: unknown[] }>(ctx, `/_apis/projectCollections?api-version=${API}`);
    return result.value ?? [];
  },
});

export const projectListCommand = adoArea.command({
  path: ['ado', 'project', 'list'],
  description: 'List team projects in a collection',
  toolDescription: 'Lists every team project in the collection (id, name, state, visibility), following continuation tokens to the end.',
  input: z.object({}),
  writes: false,
  examples: [AT],
  run: async (_input, ctx) => {
    const { collection } = where(ctx);
    return adoAll(ctx, `/${enc(collection)}/_apis/projects`, { 'api-version': API }, `Azure DevOps projects in ${collection}`);
  },
});

export const projectGetCommand = adoArea.command({
  path: ['ado', 'project', 'get'],
  description: 'Get a team project by name',
  toolDescription: 'Returns one team project in the collection by name or id.',
  input: z.object({ name: z.string().describe('Project name') }),
  writes: false,
  options: [{ flags: '--name <project>', field: 'name', description: 'Project name' }],
  examples: [{ ...AT, name: 'Imagile' }],
  run: async (input, ctx) => {
    const { collection } = where(ctx);
    return ado(ctx, `/${enc(collection)}/_apis/projects/${enc(input.name)}?api-version=${API}`);
  },
});

export const serverCommands = [whoamiCommand, connectionDataCommand, projectListCollectionsCommand, projectListCommand, projectGetCommand];
