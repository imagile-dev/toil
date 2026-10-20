import { z } from 'zod';
import { kibanaArea } from './area.js';
import { kibana, spacePath } from './client.js';

/**
 * Data views (index patterns) in a space, from GET /api/data_views, which
 * Kibana added in 8.0. Unpaged, as the API is. A data view with no name goes
 * by its pattern, which is what everyone called it anyway.
 * https://www.elastic.co/docs/api/doc/kibana/operation/operation-getalldataviewsdefault
 */

interface DataViews {
  data_view?: Array<{ id: string; name?: string; title: string; namespaces?: string[] }>;
}

export const dataViewsListCommand = kibanaArea.command({
  path: ['kibana', 'data-view', 'list'],
  description: 'List data views (id, name, index pattern)',
  input: z.object({}),
  writes: false,
  context: { space: 'optional' },
  examples: [{}, { space: 'ops' }],
  run: async (_input, ctx) => {
    const space = ctx.context.space;
    const data = await kibana<DataViews>(ctx, spacePath(space, '/api/data_views'));
    const dataViews = (data.data_view ?? []).map((v) => ({ id: v.id, name: v.name || v.title, pattern: v.title, namespaces: v.namespaces }));
    return { space: space || 'default', count: dataViews.length, dataViews };
  },
});

export const dataViewsCommands = [dataViewsListCommand];
