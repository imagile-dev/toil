import { z } from 'zod';
import { dynatraceArea } from './area.js';
import { allPages, type DynatraceContext } from './client.js';

/**
 * `services` and `workloads`: entity lists with the selector already filled
 * in, `type("SERVICE")` and `type("CLOUD_APPLICATION")`, each returned under
 * its own key. A pre-filled form is still a form, but at least it is short.
 */

const window = z.object({
  from: z.string().optional().describe('Start time'),
  to: z.string().optional().describe('End time'),
});

const windowOptions = [
  { flags: '--from <time>', field: 'from', description: 'Start time' },
  { flags: '--to <time>', field: 'to', description: 'End time' },
];

const entitiesOfType = (ctx: DynatraceContext, selector: string, input: z.output<typeof window>, what: string) =>
  allPages(ctx, '/api/v2/entities', 'entities', { entitySelector: selector, from: input.from, to: input.to }, what);

export const servicesCommand = dynatraceArea.command({
  path: ['dynatrace', 'services'],
  description: 'List monitored services',
  input: window,
  writes: false,
  options: windowOptions,
  examples: [{}, { from: 'now-6h', to: 'now', env: 'prod' }],
  run: async (input, ctx) => {
    const { totalCount, items } = await entitiesOfType(ctx, 'type("SERVICE")', input, 'Dynatrace services');
    return { totalCount, services: items };
  },
});

export const workloadsCommand = dynatraceArea.command({
  path: ['dynatrace', 'workloads'],
  description: 'List monitored Kubernetes workloads',
  input: window,
  writes: false,
  options: windowOptions,
  examples: [{}, { from: 'now-6h', to: 'now', env: 'prod' }],
  run: async (input, ctx) => {
    const { totalCount, items } = await entitiesOfType(ctx, 'type("CLOUD_APPLICATION")', input, 'Dynatrace workloads');
    return { totalCount, workloads: items };
  },
});

export const servicesCommands = [servicesCommand, workloadsCommand];
