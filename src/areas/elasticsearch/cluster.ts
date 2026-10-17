import { z } from 'zod';
import { elasticsearchArea } from './area.js';
import { es } from './client.js';

/**
 * Cluster health, as Elasticsearch reports it: GET /_cluster/health, body
 * returned untouched. A red cluster still answers 200, so the status is in
 * the data, not the error; reporting a fire is not the same as being on fire.
 * https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cluster-health
 */

export const clusterHealthCommand = elasticsearchArea.command({
  path: ['elasticsearch', 'cluster', 'health'],
  description: 'Show cluster health (status, node and shard counts)',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => es<Record<string, unknown>>(ctx, '/_cluster/health'),
});

export const clusterCommands = [clusterHealthCommand];
