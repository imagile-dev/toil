/**
 * The agent's tools (#251): read-only, scoped to one dossier, and the same
 * list for every adapter. Four read the cache a sync filled (`owi_query`,
 * `owi_get`, `owi_history`, and `owi_similar`, the scorer `toil util owi
 * similar` runs); the rest are `toil mcp`'s own read tools, by
 * their MCP names, for live lookups through `@imagile-dev/toil/api`'s
 * `execute()` with `readOnly: true`. There is no write tool, and a live tool
 * is built only for a command the registry says never writes, so the list
 * can't grow one by accident (test/agents.test.ts asserts it).
 *
 * Every tool call adds the ids it returned to a ledger: the items, the
 * parents, children and link targets they name, and the pull requests,
 * builds and deployments linked to them. An answer may cite only ids in its
 * ledger: anything else it names is flagged (answer.ts). A reading room with a sign-out sheet and no photocopier.
 */

import type { Cache, ChangeRow, TransitionRow } from '../cache.ts';
import type { Envelope, Execute, WorkItem } from '../../src/toil.ts';
import { SimilarityIndex } from '../../../src/core/owi/similar.ts';
import { CALLER } from '../store.ts';

/** What the cache tools read: one dossier's synced rows. */
export interface AgentData {
  items(): WorkItem[];
  transitions(itemId: string): TransitionRow[];
  changes(): ChangeRow[];
  /** When the dossier was last synced, or null if never. */
  syncedAt(): string | null;
}

/** A dossier's rows in the SQLite cache, or null when it has never synced. */
export function cacheData(cache: Pick<Cache, 'states' | 'items' | 'transitions' | 'changes'>, dossier: string): AgentData | null {
  const state = cache.states().find((s) => s.name === dossier);
  if (!state) return null;
  return {
    items: () => cache.items(dossier),
    transitions: (id) => cache.transitions(dossier, id),
    changes: () => cache.changes(dossier),
    syncedAt: () => state.lastSyncAt,
  };
}

/** One tool, described once for every SDK: a name, what it does, its input as JSON Schema, and what it runs. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema (an object) of the input. */
  inputSchema: { type: 'object'; properties: Record<string, Record<string, unknown>>; required?: string[]; additionalProperties: false };
  /** Runs the tool. Never throws: a failure is `{ error }`, which the model reads. */
  run(input: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

/** What a registry entry must say before it becomes a live tool. */
export interface ReadCommand {
  name: string;
  tool: string;
  area?: string;
  description: string;
  writes: boolean;
  writesLocal: boolean;
  writesDependOnInput: boolean;
  inputSchema: Record<string, unknown>;
}

/**
 * The live lookups the agent may make: the dashboards' own reads plus a
 * single item's fetch. `dossiers list` is left out: an answer is about one
 * dossier.
 */
export const LIVE_COMMANDS: readonly string[] = [
  'dossiers show',
  'jira issue search',
  'jira issue get',
  'jira issue history',
  'ado work-item search',
  'ado work-item get',
  'ado work-item get-many',
  'ado work-item history',
  'ado work-item iterations',
  'ado pr list',
  'ado run list',
  'github issue get',
  'github issue history',
  'github project items',
  'github pr list',
  'github commit checks',
  'bitbucket pr list',
  'jenkins pipeline runs',
  'openshift deployment list',
];

/** Fields a live tool never offers: the dossier is fixed, and a file or folder on this machine is not the agent's to name. */
const HIDDEN_FIELDS = new Set(['dossier', 'cwd', 'connection', 'select']);
const hidden = (field: string) => HIDDEN_FIELDS.has(field) || /File$/.test(field) || field === 'out' || field === 'allowWrite';

/** The bounds on what one tool call returns (Bounds). */
export const MAX_QUERY = 200;
export const DEFAULT_QUERY = 50;
const MAX_BODY_CHARS = 4000;
/** A live result is cut to this many characters of JSON, and says so. */
export const MAX_LIVE_CHARS = 60_000;

/** The ids a tool result vouches for, and the tool calls made: what answer.ts checks citations against. */
export class Ledger {
  readonly ids = new Set<string>();
  readonly calls: Array<{ tool: string; input: Record<string, unknown> }> = [];
  add(id: string | null | undefined) {
    if (id) this.ids.add(id);
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** Who an item is assigned to, by name, else by id: GitHub names people by login alone, which OWI keeps as the id. */
const assigneeOf = (item: WorkItem) => (item.assignee ? (item.assignee.name ?? item.assignee.id) : null);

/** An item as a tool returns it: no `native` record, a bounded body. */
function brief(item: WorkItem) {
  return {
    id: item.id,
    type: item.type,
    typeName: item.typeName,
    title: item.title,
    status: item.status,
    statusCategory: item.statusCategory,
    assignee: assigneeOf(item),
    priority: item.priority,
    estimate: item.estimate ? { value: item.estimate.value, unit: item.estimate.unit, field: item.estimate.field } : null,
    labels: item.labels,
    iteration: item.iteration?.name ?? null,
    parent: item.parent,
    children: item.children,
    links: item.links.map((l) => ({ type: l.type, direction: l.direction, target: l.target, name: l.name })),
    created: item.created,
    updated: item.updated,
    resolved: item.resolved,
    url: item.url,
  };
}

function bodyText(item: WorkItem): string | null {
  if (!item.body) return null;
  const text = typeof item.body.content === 'string' ? item.body.content : JSON.stringify(item.body.content);
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… (cut at ${MAX_BODY_CHARS} characters)` : text;
}

/** Every id a returned item names (its own, its parent, children and link targets): each is in the tool's result, so an answer may cite it. */
function vouch(ledger: Ledger, item: Pick<WorkItem, 'id' | 'parent' | 'children' | 'links'>) {
  ledger.add(item.id);
  ledger.add(item.parent);
  for (const c of item.children) ledger.add(c);
  for (const l of item.links) ledger.add(l.target);
}

/** The most matches owi_similar returns, and how many by default. */
export const MAX_SIMILAR = 20;
export const DEFAULT_SIMILAR = 5;

/** The four cache tools for one dossier. */
export function cacheTools(dossier: string, data: AgentData, ledger: Ledger): ToolSpec[] {
  const note = () => ({ dossier, syncedAt: data.syncedAt() });
  return [
    {
      name: 'owi_query',
      description: `Lists the work items Toil UI's cache holds for the dossier "${dossier}", as OWI records (no native payload). Filter by any of the fields; all filters must match. Text matches the id or title, case-insensitively. Returns at most ${MAX_QUERY} items and says when there were more.`,
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Words in the id or title.' },
          type: { type: 'string', enum: ['EPIC', 'STORY', 'TASK', 'BUG', 'INCIDENT', 'OTHER'] },
          statusCategory: { type: 'string', enum: ['TODO', 'IN_PROGRESS', 'DONE'] },
          status: { type: 'string', description: "The source's own status word." },
          assignee: { type: 'string', description: 'Part of the assignee name; "none" for unassigned.' },
          iteration: { type: 'string', description: 'Part of the iteration (sprint) name.' },
          label: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_QUERY, description: `Default ${DEFAULT_QUERY}.` },
        },
        additionalProperties: false,
      },
      async run(input) {
        const text = str(input.text)?.toLowerCase();
        const assignee = str(input.assignee)?.toLowerCase();
        const iteration = str(input.iteration)?.toLowerCase();
        const limit = Math.min(MAX_QUERY, Math.max(1, Number.isInteger(input.limit) ? (input.limit as number) : DEFAULT_QUERY));
        const matches = data.items().filter(
          (i) =>
            (!text || i.id.toLowerCase().includes(text) || i.title.toLowerCase().includes(text)) &&
            (!str(input.type) || i.type === input.type) &&
            (!str(input.statusCategory) || i.statusCategory === input.statusCategory) &&
            (!str(input.status) || (i.status ?? '').toLowerCase() === String(input.status).toLowerCase()) &&
            (!assignee || (assignee === 'none' ? !i.assignee : (assigneeOf(i) ?? '').toLowerCase().includes(assignee))) &&
            (!iteration || (i.iteration?.name ?? '').toLowerCase().includes(iteration)) &&
            (!str(input.label) || i.labels.includes(String(input.label))),
        );
        const items = matches.slice(0, limit).map(brief);
        for (const i of items) vouch(ledger, i);
        return { ...note(), total: matches.length, returned: items.length, ...(matches.length > limit ? { more: `${matches.length - limit} more match; narrow the filters or raise limit (max ${MAX_QUERY}).` } : {}), items };
      },
    },
    {
      name: 'owi_get',
      description: `One work item from the cache for "${dossier}", by its OWI id (such as jira:PAY-101), with its body and the pull requests, builds and deployments linked to it.`,
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The OWI id.' } }, required: ['id'], additionalProperties: false },
      async run(input) {
        const id = str(input.id);
        const item = id ? data.items().find((i) => i.id === id) : undefined;
        if (!item) return { ...note(), error: `The cache holds no item ${JSON.stringify(id ?? '')} in ${dossier}. Use owi_query to find ids.` };
        vouch(ledger, item);
        const changes = data
          .changes()
          .filter((c) => c.items.includes(item.id))
          .map((c) => ({ kind: c.kind, id: c.id, area: c.area, state: c.state, outcome: c.outcome, at: c.at }));
        for (const c of changes) ledger.add(c.id);
        return { ...note(), item: { ...brief(item), body: bodyText(item) }, changes };
      },
    },
    {
      name: 'owi_similar',
      description: `Finds likely duplicate work items in the cache for "${dossier}", scored the way toil util owi similar scores them: pass query (some text, such as the title of an item about to be filed) or id (an OWI id, to find what duplicates that item). Returns at most limit matches scoring 0.35 or more, best first, each with score (0 to 1) and why: the shared title and body terms, how alike the titles are by trigram, shared labels, the same parent and a direct link. Lexical: it finds shared words, not shared meaning.`,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to rank the items against.' },
          id: { type: 'string', description: 'The OWI id of an item, to rank the others against it.' },
          limit: { type: 'integer', minimum: 1, maximum: MAX_SIMILAR, description: `Default ${DEFAULT_SIMILAR}.` },
        },
        additionalProperties: false,
      },
      async run(input) {
        const query = str(input.query);
        const id = str(input.id);
        if (!query === !id) return { ...note(), error: 'Pass exactly one of query (text to rank against) and id (an OWI id from owi_query).' };
        const limit = Math.min(MAX_SIMILAR, Math.max(1, Number.isInteger(input.limit) ? (input.limit as number) : DEFAULT_SIMILAR));
        const index = new SimilarityIndex(data.items());
        const found = query ? index.query(query, { limit }) : index.item(id!, { limit });
        if (!found) return { ...note(), error: `The cache holds no item ${JSON.stringify(id)} in ${dossier}. Use owi_query to find ids.` };
        if (id) ledger.add(id);
        const matches = found.matches.map((m) => ({ id: m.id, title: m.title, score: m.score, why: { summary: m.why.summary, titleTerms: m.why.titleTerms, bodyTerms: m.why.bodyTerms, trigram: m.why.trigram, labels: m.why.labels, parent: m.why.parent, link: m.why.link } }));
        for (const m of matches) ledger.add(m.id);
        return { ...note(), count: found.count, returned: matches.length, matches };
      },
    },
    {
      name: 'owi_history',
      description: `The status transitions the cache holds for one work item in "${dossier}" (from, to, when, by whom), oldest first.`,
      inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The OWI id.' } }, required: ['id'], additionalProperties: false },
      async run(input) {
        const id = str(input.id);
        const item = id ? data.items().find((i) => i.id === id) : undefined;
        if (!item) return { ...note(), error: `The cache holds no item ${JSON.stringify(id ?? '')} in ${dossier}. Use owi_query to find ids.` };
        ledger.add(item.id);
        return { ...note(), id: item.id, transitions: data.transitions(item.id).map((t) => ({ from: t.from, to: t.to, fromCategory: t.fromCategory, toCategory: t.toCategory, at: t.at, by: t.by })) };
      },
    },
  ];
}

/** True when a registry entry can never change anything, whatever its input. */
export const neverWrites = (c: Pick<ReadCommand, 'writes' | 'writesLocal' | 'writesDependOnInput'>) => !c.writes && !c.writesLocal && !c.writesDependOnInput;

/** The ids an envelope's work items map to, through toil's own OWI mappers. Nothing when it doesn't map. */
export type MapIds = (envelope: Envelope) => string[];

/**
 * `toil mcp`'s read tools for live lookups, one per command in `LIVE_COMMANDS`
 * that the registry has and says never writes. The dossier is fixed to this
 * one; every call is read-only with Toil UI's caller label.
 */
export function liveTools(dossier: string, registry: readonly ReadCommand[], execute: Execute, mapIds: MapIds, ledger: Ledger): ToolSpec[] {
  const tools: ToolSpec[] = [];
  for (const name of LIVE_COMMANDS) {
    const command = registry.find((c) => c.name === name);
    if (!command || !neverWrites(command)) continue;
    const schema = command.inputSchema as { properties?: Record<string, Record<string, unknown>>; required?: string[] };
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([k]) => !hidden(k)));
    const required = (schema.required ?? []).filter((k) => !hidden(k));
    tools.push({
      name: command.tool,
      description: `Live, read-only: toil ${command.name} for the dossier "${dossier}", straight from the tracker rather than the cache. ${command.description}`,
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
      async run(input, signal) {
        const clean = Object.fromEntries(Object.entries(input).filter(([k]) => k in properties));
        const envelope = await execute(command.name, { ...clean, ...('dossier' in (schema.properties ?? {}) ? { dossier } : {}) }, { readOnly: true, caller: CALLER, ...(signal ? { signal } : {}) });
        if (envelope.ok) for (const id of mapIds(envelope)) ledger.add(id);
        const text = JSON.stringify(envelope.ok ? { data: envelope.data, warnings: envelope.meta.warnings ?? [] } : { error: envelope.error });
        return text.length > MAX_LIVE_CHARS ? { cut: `The result was ${text.length} characters, cut to ${MAX_LIVE_CHARS}; ask for fewer with limit or a narrower query.`, json: text.slice(0, MAX_LIVE_CHARS) } : JSON.parse(text);
      },
    });
  }
  return tools;
}

/**
 * `proposal_fields`: the input a toil write command takes, from the
 * registry, so a proposal's input is one toil would accept. It reads the
 * registry and runs nothing; the command itself is never callable.
 */
export function proposalTool(registry: readonly ReadCommand[]): ToolSpec {
  const hiddenHere = new Set(['dossier', 'cwd', 'select', 'allowWrite']);
  return {
    name: 'proposal_fields',
    description: "The input fields of one toil write command (such as jira issue update or ado work-item update), for a proposal's input. It reads toil's command list and runs nothing: you can't call a write command, only propose one.",
    inputSchema: { type: 'object', properties: { command: { type: 'string', description: 'The toil command, such as jira issue update.' } }, required: ['command'], additionalProperties: false },
    async run(input) {
      const name = str(input.command);
      const c = name ? registry.find((r) => r.name === name) : undefined;
      if (!c || !c.writes) {
        const like = registry.filter((r) => r.writes && name && r.area === name.split(' ')[0]).map((r) => r.name);
        return { error: `toil has no write command ${JSON.stringify(name ?? '')}.`, ...(like.length ? { writeCommandsInThatArea: like } : {}) };
      }
      const s = c.inputSchema as { properties?: Record<string, { type?: unknown; description?: unknown; enum?: unknown; items?: unknown }>; required?: string[] };
      const fields = Object.fromEntries(Object.entries(s.properties ?? {}).filter(([k]) => !hiddenHere.has(k)).map(([k, v]) => [k, { type: v.type, ...(v.enum ? { enum: v.enum } : {}), ...(v.items ? { items: v.items } : {}), description: v.description }]));
      return { command: c.name, description: c.description, fields, required: (s.required ?? []).filter((k) => !hiddenHere.has(k)) };
    },
  };
}

/** Wraps every tool so the ledger records the call. */
export function recorded(tools: ToolSpec[], ledger: Ledger): ToolSpec[] {
  return tools.map((t) => ({
    ...t,
    async run(input, signal) {
      ledger.calls.push({ tool: t.name, input });
      try {
        return await t.run(input ?? {}, signal);
      } catch (e) {
        return { error: `${t.name} failed: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }));
}
