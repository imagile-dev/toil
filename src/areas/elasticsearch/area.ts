import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * Elasticsearch: cluster health, the index list, and search and count over
 * the REST API, authenticated with an API key. Every command reads. Kibana
 * borrows this area's `apiKey` when a Kibana connection is paired with one
 * (`apiKeyFrom`), so the key keeps the same name and stays a secret here; the
 * paperwork for the loan is filed on Kibana's side.
 */
export const elasticsearchArea = defineArea({
  name: 'elasticsearch',
  description: 'Elasticsearch: cluster health, indices, and search and count with Query DSL or a query string',
  connection: z.object({
    baseUrl: z.url().describe('Elasticsearch root, e.g. https://elasticsearch.imagile.dev (keep any context path)'),
    apiKey: z.string().min(1).describe('API key: the encoded value shown once when the key is created'),
  }),
  secrets: ['apiKey'],
  // Who the API key authenticates as; anonymous access, where enabled, reports the anonymous realm.
  probe: () => ({ path: '/_security/_authenticate', accepts: (body) => !String((body as { authentication_realm?: { name?: unknown } } | null)?.authentication_realm?.name ?? '').startsWith('__anonymous') }),
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    // https://www.elastic.co/docs/api/doc/elasticsearch/authentication
    headers: { Authorization: `ApiKey ${connection.apiKey}` },
    service: 'Elasticsearch',
    authFix: `Elasticsearch rejected the API key on connection "${connection.name}", or it lacks the privilege for this request. Create a key in Kibana (Stack Management → API keys) with read access to the indices you need, then set apiKey (${area.envName('apiKey')} for the default connection, or toil connections login ${connection.name}).`,
  }),
});

/** Not established: built from Elastic's current REST API reference, and reads `hits.total` in both of its shapes. */
export const elasticsearchSupported: SupportedVersion = {
  product: 'Elasticsearch',
  minimum: null,
  api: 'REST API',
  note: "toil calls _cluster/health, _cat/indices, _search and _count with an API key sent as an ApiKey header. Requests follow Elastic's current REST API reference; no release has been verified yet.",
};
