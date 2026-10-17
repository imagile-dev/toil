import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { elasticsearchArea } from './area.js';
import { es, indexPath } from './client.js';

/**
 * The index list, from the cat indices API with `format=json` and the columns
 * named in `h`, so each row has exactly those keys, every value a string.
 * Elastic says the cat APIs are meant for people at a console rather than
 * for applications; an agent reading a table on someone's behalf is close
 * enough, and the alternative is a form per index.
 * https://www.elastic.co/docs/api/doc/elasticsearch/operation/operation-cat-indices
 */

const COLUMNS = 'index,health,status,docs.count,store.size,pri,rep';

export const indicesListCommand = elasticsearchArea.command({
  path: ['elasticsearch', 'indices', 'list'],
  description: 'List indices with health, document count and size',
  input: z.object({
    pattern: z.string().optional().describe('Index name or wildcard pattern (e.g. "logs-*")'),
  }),
  writes: false,
  options: [{ flags: '--pattern <pattern>', field: 'pattern', description: 'Index name or wildcard pattern (e.g. "logs-*")' }],
  examples: [{}, { pattern: 'logs-*,metrics-*' }],
  run: async (input, ctx) => {
    const path = input.pattern ? `/_cat/indices/${indexPath(input.pattern, '--pattern')}` : '/_cat/indices';
    const rows = await es<unknown[]>(ctx, path, { query: { format: 'json', h: COLUMNS } });
    if (!Array.isArray(rows)) {
      throw new ToilError('HTTP', `Elasticsearch answered ${path} with something other than a list of indices.`, {
        fix: 'Check baseUrl points at Elasticsearch itself, not Kibana or a proxy in front of it.',
      });
    }
    return { count: rows.length, indices: rows };
  },
});

export const indicesCommands = [indicesListCommand];
