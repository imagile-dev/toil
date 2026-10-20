import { z } from 'zod';
import { dynatraceArea } from './area.js';
import { allPages, dynatrace } from './client.js';

/**
 * Monitored entities from the classic environment API: a list by entity
 * selector, every page of it, and one entity by id. The selector syntax is
 * Dynatrace's; toil forwards it unread, as any good intermediary forwards a
 * form it was not trained to fill in.
 */

export const entitiesListCommand = dynatraceArea.command({
  path: ['dynatrace', 'entity', 'list'],
  description: 'List monitored entities using an entity selector',
  input: z.object({
    selector: z.string().describe('Dynatrace entity selector, e.g. type("SERVICE")'),
    from: z.string().optional().describe('Start time (ISO 8601 or relative, e.g. now-2h)'),
    to: z.string().optional().describe('End time (ISO 8601 or relative)'),
    fields: z.string().optional().describe('Additional entity fields'),
  }),
  writes: false,
  options: [
    { flags: '--selector <selector>', field: 'selector', description: 'Dynatrace entity selector, e.g. type("SERVICE")' },
    { flags: '--from <time>', field: 'from', description: 'Start time (ISO 8601 or relative, e.g. now-2h)' },
    { flags: '--to <time>', field: 'to', description: 'End time (ISO 8601 or relative)' },
    { flags: '--fields <fields>', field: 'fields', description: 'Additional entity fields' },
  ],
  examples: [{ selector: 'type("HOST")' }, { selector: 'type("PROCESS_GROUP")', from: 'now-1d', to: 'now', fields: '+properties,+tags', env: 'prod' }],
  run: async (input, ctx) => {
    const { totalCount, items } = await allPages(ctx, '/api/v2/entities', 'entities', { entitySelector: input.selector, from: input.from, to: input.to, fields: input.fields }, 'Dynatrace entities');
    return { totalCount, entities: items };
  },
});

export const entitiesGetCommand = dynatraceArea.command({
  path: ['dynatrace', 'entity', 'get'],
  description: 'Get a monitored entity by ID',
  input: z.object({
    id: z.string().describe('Entity ID, e.g. SERVICE-1234567890ABCDEF'),
    from: z.string().optional().describe('Start time'),
    to: z.string().optional().describe('End time'),
    fields: z.string().optional().describe('Additional entity fields'),
  }),
  writes: false,
  args: [{ name: 'id', field: 'id', description: 'Entity ID, e.g. SERVICE-1234567890ABCDEF' }],
  options: [
    { flags: '--from <time>', field: 'from', description: 'Start time' },
    { flags: '--to <time>', field: 'to', description: 'End time' },
    { flags: '--fields <fields>', field: 'fields', description: 'Additional entity fields' },
  ],
  examples: [{ id: 'SERVICE-1234567890ABCDEF' }, { id: 'HOST-ABC1234500000000', from: 'now-2h', to: 'now', fields: '+properties', env: 'prod' }],
  // The server's entity, passed through as it came.
  run: async (input, ctx) => dynatrace(ctx, `/api/v2/entities/${encodeURIComponent(input.id)}`, { query: { from: input.from, to: input.to, fields: input.fields } }),
});

export const entitiesCommands = [entitiesListCommand, entitiesGetCommand];
