import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Falcon LogScale: searches a repository with the Query Language and lists
 * the repositories a token can see. Built from LogScale's own API docs
 * (library.humio.com), since nothing here has met a live cluster yet; the
 * docs are the only witness on file, and they were not cross-examined.
 */
export const logscaleArea = defineArea({
  name: 'logscale',
  description: 'Falcon LogScale: Query Language searches and repositories',
  connection: z.object({
    baseUrl: z.url().describe('LogScale server root, e.g. https://logscale.imagile.dev'),
    token: z.string().min(1).describe('LogScale personal API token'),
  }),
  secrets: ['token'],
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.token}` },
    service: 'LogScale',
    authFix: `LogScale rejected the token on connection "${connection.name}". Create a personal API token under your account settings → Personal API Token (or use a token with read access to the repository), then set token (${area.envName('token')} for the default connection).`,
  }),
});

/** Not established: the commands use the documented Search API (`/api/v1`) and the GraphQL API (`/graphql`). */
export const logscaleSupported: SupportedVersion = {
  product: 'Falcon LogScale',
  minimum: null,
  api: 'Search API v1 and GraphQL API',
  note: 'toil calls the synchronous Search API (/api/v1/repositories/<repo>/query) and the GraphQL repositories query, with a token sent as a Bearer header. No release has been verified yet.',
};
