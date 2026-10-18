import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import { ToilError } from '../../core/errors.js';
import type { SupportedVersion } from '../../core/supported.js';
import { elasticsearchArea } from '../elasticsearch/area.js';

/**
 * Kibana: status, spaces, dashboards, data views and alerting rules, read
 * from Kibana's REST API with an API key. The key may be an Elasticsearch
 * connection's, but only when the user pairs the two (`apiKeyFrom`): a key
 * on loan still needs the lender's signature, even when the lender is you.
 */
export const kibanaArea = defineArea({
  name: 'kibana',
  description: 'Kibana: status, spaces, dashboards, data views and alerting rules',
  connection: z.object({
    baseUrl: z.url().describe('Kibana root, e.g. https://kibana.imagile.dev (keep any context path, such as a basePath)'),
    apiKey: z.string().min(1).optional().describe('API key: the encoded value; unset, a paired Elasticsearch connection\'s key is used'),
    space: z.string().min(1).optional().describe('Default space id for dashboards, data views and rules (unset: the default space)'),
  }),
  secrets: ['apiKey'],
  // The default connection falls back to TOIL_ELASTICSEARCH_API_KEY; any
  // connection can name an Elasticsearch connection to borrow from with apiKeyFrom.
  shares: { area: elasticsearchArea, keys: ['apiKey'] },
  notConfigured: { message: 'Kibana baseUrl not configured.' },
  context: {
    space: {
      description: 'Kibana space ID (default: kibana.space, else the default space)',
      flags: '--space <id>',
      scope: 'command',
      setting: 'space',
    },
  },
  // The status page can be public; the spaces list needs a user.
  probe: () => ({ path: '/api/spaces/space' }),
  request: (connection, area) => {
    if (!connection.apiKey) {
      throw new ToilError('NOT_CONFIGURED', `Kibana credentials not configured on connection "${connection.name}".`, {
        fix: `Set apiKey (${area.envName('apiKey')} for the default connection, or toil connections login ${connection.name}), or pair it with an Elasticsearch connection whose key it should use: "apiKeyFrom": "<elasticsearch connection>".`,
      });
    }
    return {
      baseUrl: connection.baseUrl,
      // https://www.elastic.co/docs/api/doc/kibana/authentication
      // kbn-xsrf: Kibana refuses every non-GET request without it (CSRF protection); harmless on a GET.
      headers: { Authorization: `ApiKey ${connection.apiKey}`, 'kbn-xsrf': 'true' },
      service: 'Kibana',
      authFix: `Kibana rejected the API key on connection "${connection.name}", or it lacks the privilege for this request. Create a key in Kibana (Stack Management → API keys) with access to the Kibana features you need, then set apiKey (${area.envName('apiKey')} for the default connection, or toil connections login ${connection.name}).`,
    };
  },
});

/** Not established: status reads both the 7.x and 8.x shapes, and data views need 8.0. */
export const kibanaSupported: SupportedVersion = {
  product: 'Kibana',
  minimum: null,
  api: 'REST API',
  note: "toil calls /api/status, /api/spaces/space, /api/saved_objects/_find and _export, /api/data_views and the alerting rule APIs with an API key sent as an ApiKey header. Requests follow Elastic's current Kibana API reference; data views list needs Kibana 8.0 or later. No release has been verified yet.",
};
