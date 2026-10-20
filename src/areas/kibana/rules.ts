import { z } from 'zod';
import { kibanaArea } from './area.js';
import { kibana, positiveInt, spacePath } from './client.js';

/**
 * Alerting rules in a space: one page of the find API, or one rule with its
 * params and actions. Each is flattened to its schedule and how its last run
 * went, the two things anyone asks about a rule before asking who owns it.
 */

/** A number given as text on the CLI or as a number over MCP. */
const intText = z.union([z.number(), z.string()]);

interface Rule {
  id: string;
  name: string;
  rule_type_id: string;
  consumer?: string;
  enabled: boolean;
  tags?: string[];
  schedule?: { interval?: string };
  mute_all?: boolean;
  execution_status?: { status?: string; last_execution_date?: string; error?: { reason?: string; message?: string } };
  last_run?: { outcome?: string };
  next_run?: string | null;
  updated_at?: string;
}

interface RulesFindResponse {
  page: number;
  per_page: number;
  total: number;
  data: Rule[];
}

/** One rule, flattened: its type, schedule, mute state and how the last run went. */
export function summarizeRule(r: Rule): Record<string, unknown> {
  return {
    id: r.id,
    name: r.name,
    ruleTypeId: r.rule_type_id,
    consumer: r.consumer,
    enabled: r.enabled,
    muted: r.mute_all ?? false,
    tags: r.tags ?? [],
    interval: r.schedule?.interval,
    executionStatus: r.execution_status?.status,
    lastExecutionDate: r.execution_status?.last_execution_date,
    lastRunOutcome: r.last_run?.outcome,
    error: r.execution_status?.error?.message,
    nextRun: r.next_run,
    updatedAt: r.updated_at,
  };
}

// GET /api/alerting/rules/_find:
// https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-alerting-rules-find
export const rulesListCommand = kibanaArea.command({
  path: ['kibana', 'rule', 'list'],
  description: 'List alerting rules with their schedule and last execution status',
  input: z.object({
    search: z.string().optional().describe('Match rule names; supports a trailing * wildcard'),
    page: intText.default('1').describe('Page number (default: "1")'),
    pageSize: intText.default('100').describe('Results per page (default: "100")'),
  }),
  writes: false,
  context: { space: 'optional' },
  options: [
    { flags: '--search <text>', field: 'search', description: 'Match rule names; supports a trailing * wildcard' },
    { flags: '--page <n>', field: 'page', description: 'Page number (default: "1")' },
    { flags: '--page-size <n>', field: 'pageSize', description: 'Results per page (default: "100")' },
  ],
  examples: [{}, { search: 'High*', space: 'ops', page: '1', pageSize: '20' }],
  run: async (input, ctx) => {
    const space = ctx.context.space;
    const page = positiveInt(input.page, '--page');
    const perPage = positiveInt(input.pageSize, '--page-size');
    const data = await kibana<RulesFindResponse>(ctx, spacePath(space, '/api/alerting/rules/_find'), {
      query: { search: input.search, search_fields: input.search ? 'name' : undefined, page, per_page: perPage },
    });
    const rules = data.data.map(summarizeRule);
    return { space: space || 'default', total: data.total, page: data.page, perPage: data.per_page, count: rules.length, rules };
  },
});

// GET /api/alerting/rule/{id}:
// https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-alerting-rule-id
export const rulesGetCommand = kibanaArea.command({
  path: ['kibana', 'rule', 'get'],
  description: 'Get one alerting rule, including its params and actions',
  input: z.object({
    id: z.string().min(1).describe('Rule ID'),
  }),
  writes: false,
  context: { space: 'optional' },
  args: [{ name: 'id', field: 'id', description: 'Rule ID' }],
  examples: [{ id: 'abc12345-0000-0000-0000-000000000000' }, { id: 'abc12345-0000-0000-0000-000000000000', space: 'ops' }],
  run: async (input, ctx) => {
    const space = ctx.context.space;
    const data = await kibana<Rule & Record<string, unknown>>(ctx, spacePath(space, `/api/alerting/rule/${encodeURIComponent(input.id)}`));
    return { ...summarizeRule(data), params: data.params, actions: data.actions };
  },
});

export const rulesCommands = [rulesListCommand, rulesGetCommand];
