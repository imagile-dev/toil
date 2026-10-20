import { z } from 'zod';
import { kibanaArea } from './area.js';
import { kibana, kibanaNdjson, positiveInt, spacePath } from './client.js';

/**
 * Dashboards in a space: one page of the saved-objects find API, and an
 * export of chosen dashboards as NDJSON. Paging is the caller's: total, page
 * and perPage come back so the next page can be asked for, one form at a time.
 */

/** A number given as text on the CLI or as a number over MCP. */
const intText = z.union([z.number(), z.string()]);

interface SavedObject {
  id: string;
  type: string;
  updated_at?: string;
  attributes?: { title?: string; description?: string };
}

interface FindResponse {
  page: number;
  per_page: number;
  total: number;
  saved_objects: SavedObject[];
}

// GET /api/saved_objects/_find?type=dashboard (deprecated by Kibana in favour of export, still served):
// https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-saved-objects-find
export const dashboardsListCommand = kibanaArea.command({
  path: ['kibana', 'dashboard', 'list'],
  description: 'List dashboards (id, title, description, last updated)',
  input: z.object({
    search: z.string().optional().describe('Match dashboard titles; supports a trailing * wildcard (e.g. "payments*")'),
    page: intText.default('1').describe('Page number (default: "1")'),
    pageSize: intText.default('100').describe('Results per page (default: "100")'),
  }),
  writes: false,
  context: { space: 'optional' },
  options: [
    { flags: '--search <text>', field: 'search', description: 'Match dashboard titles; supports a trailing * wildcard (e.g. "payments*")' },
    { flags: '--page <n>', field: 'page', description: 'Page number (default: "1")' },
    { flags: '--page-size <n>', field: 'pageSize', description: 'Results per page (default: "100")' },
  ],
  examples: [{}, { search: 'pay*', space: 'ops', page: '2', pageSize: '20' }],
  run: async (input, ctx) => {
    const space = ctx.context.space;
    const page = positiveInt(input.page, '--page');
    const perPage = positiveInt(input.pageSize, '--page-size');
    const data = await kibana<FindResponse>(ctx, spacePath(space, '/api/saved_objects/_find'), {
      query: { type: 'dashboard', search: input.search, search_fields: input.search ? 'title' : undefined, page, per_page: perPage },
    });
    const dashboards = data.saved_objects.map((o) => ({
      id: o.id,
      title: o.attributes?.title,
      description: o.attributes?.description || undefined,
      updatedAt: o.updated_at,
    }));
    return { space: space || 'default', total: data.total, page: data.page, perPage: data.per_page, count: dashboards.length, dashboards };
  },
});

/** The export stream ends with a summary line ({ exportedCount, missingRefCount, ... }), not a saved object. */
const isDetails = (o: unknown): boolean => typeof o === 'object' && o !== null && 'exportedCount' in o && !('type' in o);

// POST /api/saved_objects/_export:
// https://www.elastic.co/docs/api/doc/kibana/operation/operation-post-saved-objects-export
export const dashboardsExportCommand = kibanaArea.command({
  path: ['kibana', 'dashboard', 'export'],
  description: 'Export dashboards as saved objects, including the visualizations and data views',
  input: z.object({
    id: z.array(z.string().min(1)).min(1).describe('Dashboard ID(s) to export'),
    references: z.boolean().default(true).describe('Include the visualizations and data views the dashboards reference (default: true)'),
  }),
  writes: false,
  // A POST whose body names what to export; it changes nothing.
  queryByPost: true,
  context: { space: 'optional' },
  args: [{ name: 'id', field: 'id', description: 'Dashboard ID(s) to export', variadic: true }],
  options: [
    { flags: '--no-references', field: 'references', description: 'Export only the dashboards themselves, not what they reference' },
  ],
  examples: [{ id: ['abc12345'] }, { id: ['abc12345', 'abc12346'], references: false, space: 'ops' }],
  run: async (input, ctx) => {
    const space = ctx.context.space;
    const lines = await kibanaNdjson(ctx, spacePath(space, '/api/saved_objects/_export'), {
      objects: input.id.map((id) => ({ type: 'dashboard', id })),
      includeReferencesDeep: input.references,
    });
    const objects = lines.filter((o) => !isDetails(o));
    return { space: space || 'default', count: objects.length, exportDetails: lines.find(isDetails), objects };
  },
});

export const dashboardsCommands = [dashboardsListCommand, dashboardsExportCommand];
