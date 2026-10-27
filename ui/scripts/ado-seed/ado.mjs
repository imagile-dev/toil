// What apply.mjs and cleanup.mjs share: a small Azure DevOps Services REST client,
// how a seeded item is recognised, and how an OWI record becomes a JSON Patch.
//
// A seeded item is recognised one of two ways, and nothing else is ever touched:
//
//   - `tags` (the default): it carries the tag `toil-seed` and a tag
//     `seed:<key>` naming its record in items.owi.json.
//   - `marker`, for an identity that may not create tags: its title starts
//     `[toil-seed] ` and its description ends with the paragraph
//     `[seed:<key>]`. Tags that already exist in the project are still
//     applied; one that doesn't is left off, with a warning, never created.
//
// Both scripts find candidates with one WIQL query and then check each one
// again here before acting, so an item someone else made that happens to
// match the query is still refused.
//
// The organization URL and the token come from TOIL_ADO_BASE_URL and
// TOIL_ADO_PAT, the variables toil itself reads; the project is always
// named on the command line. Nothing here writes them anywhere. Repo tooling
// only: nothing here ships. Two ways to say "this one is ours", because the
// form for the first one needed a licence.
import { SEED_TAG } from './generate.mjs';

export const API = '7.1';
export const IDENTITIES = ['tags', 'marker'];
export const TITLE_PREFIX = '[toil-seed] ';
const markerOf = (key) => `<p>[seed:${key}]</p>`;
const MARKER = /<p>\[seed:([a-z0-9-]+)\]<\/p>\s*$/;

/** A failure with what to do about it, printed by the scripts as `message` and `Fix: fix`. */
export class SeedError extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

/** The connection, from the env toil reads, checked before anything is sent. */
export function connectionFromEnv(env = process.env) {
  const baseUrl = env.TOIL_ADO_BASE_URL?.replace(/\/+$/, '');
  const pat = env.TOIL_ADO_PAT;
  if (!baseUrl || !pat) throw new SeedError('TOIL_ADO_BASE_URL and TOIL_ADO_PAT must both be set.', 'Set them to the organization URL (https://dev.azure.com/<organization>) and an organization-scoped token with Work Items (Read & write).');
  const url = new URL(baseUrl);
  if (url.hostname === 'dev.azure.com' && url.pathname.split('/').filter(Boolean).length !== 1) throw new SeedError(`${baseUrl} doesn't name one organization.`, 'Set TOIL_ADO_BASE_URL to https://dev.azure.com/<organization>, with no project.');
  return { baseUrl, pat };
}

/** A client for one organization and project. `fetch` is passed in so the tests can stub it. */
export function client({ baseUrl, pat, project, fetch: fetchFn = fetch }) {
  const auth = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  const p = encodeURIComponent(project);
  async function call(method, path, { query = {}, json, contentType = 'application/json' } = {}) {
    const qs = new URLSearchParams({ ...query, 'api-version': query['api-version'] ?? API });
    const res = await fetchFn(`${baseUrl}${path}?${qs}`, {
      method,
      headers: { Authorization: auth, Accept: 'application/json', ...(json !== undefined ? { 'Content-Type': contentType } : {}) },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    const text = await res.text();
    const body = (() => {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    })();
    if (!res.ok) {
      const message = typeof body === 'object' && body?.message ? body.message : String(text).slice(0, 300);
      throw new SeedError(`${method} ${path} answered ${res.status}: ${message}`, res.status === 401 ? 'Check TOIL_ADO_PAT: it must be for this organization and not expired.' : res.status === 403 ? "The token's identity lacks a permission this needs; the message above names it." : 'See the message above.');
    }
    return body;
  }
  const patch = (method, path, ops, query) => call(method, path, { json: ops, contentType: 'application/json-patch+json', query });
  return {
    project,
    workItemUrl: (id) => `${baseUrl}/_apis/wit/workItems/${id}`,
    me: async () => {
      const data = await call('GET', '/_apis/connectionData', { query: { 'api-version': '7.1-preview.1' } });
      const account = data?.authenticatedUser?.properties?.Account?.$value;
      if (!account) throw new SeedError("The organization's connection data names no account for this token.", 'Leave every item unassigned, or use a token made by a signed-in user.');
      return account;
    },
    projectInfo: () => call('GET', `/_apis/projects/${p}`),
    iterations: () => call('GET', `/${p}/_apis/wit/classificationnodes/iterations`, { query: { $depth: '5' } }),
    tags: async () => (await call('GET', `/${p}/_apis/wit/tags`, { query: { 'api-version': '7.1-preview.1' } }))?.value?.map((t) => t.name) ?? [],
    wiql: async (query) => (await call('POST', `/${p}/_apis/wit/wiql`, { json: { query } }))?.workItems?.map((w) => w.id) ?? [],
    getMany: async (ids) => {
      const out = [];
      for (let i = 0; i < ids.length; i += 200) {
        const body = await call('POST', '/_apis/wit/workitemsbatch', { json: { ids: ids.slice(i, i + 200), $expand: 'relations', errorPolicy: 'omit' } });
        out.push(...(body?.value ?? []).filter(Boolean));
      }
      return out;
    },
    // bypassRules lets a revision carry its own System.ChangedDate, which is how the seed backdates; it needs the permission to bypass rules.
    create: (type, ops, bypass = false) => patch('POST', `/${p}/_apis/wit/workitems/${encodeURIComponent(`$${type}`)}`, ops, bypass ? { bypassRules: 'true' } : {}),
    update: (id, ops, bypass = false) => patch('PATCH', `/_apis/wit/workitems/${id}`, ops, bypass ? { bypassRules: 'true' } : {}),
    // Without destroy, a deleted work item goes to the project's recycle bin and can be restored.
    remove: (id) => call('DELETE', `/${p}/_apis/wit/workitems/${id}`),
  };
}

/** The WIQL that finds candidates for an identity, in the project. */
export function candidateQuery(identity) {
  const where = identity === 'tags' ? `[System.Tags] CONTAINS '${SEED_TAG}'` : `[System.Title] CONTAINS '${TITLE_PREFIX.trim()}'`;
  return `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ${where} ORDER BY [System.Id]`;
}

const tagsOf = (item) => (typeof item.fields?.['System.Tags'] === 'string' ? item.fields['System.Tags'].split(';').map((t) => t.trim()).filter(Boolean) : []);

/** The seed key of a work item, or null when it isn't one of ours by the identity's rule. */
export function seedKey(item, identity, project) {
  const f = item.fields ?? {};
  if (f['System.TeamProject'] !== undefined && f['System.TeamProject'] !== project) return null;
  if (identity === 'tags') {
    const tags = tagsOf(item);
    if (!tags.includes(SEED_TAG)) return null;
    const keys = tags.filter((t) => t.startsWith('seed:')).map((t) => t.slice(5));
    return keys.length === 1 ? keys[0] : null;
  }
  if (typeof f['System.Title'] !== 'string' || !f['System.Title'].startsWith(TITLE_PREFIX)) return null;
  return typeof f['System.Description'] === 'string' ? (MARKER.exec(f['System.Description'])?.[1] ?? null) : null;
}

/** Every seeded item in the project by the identity's rule, keyed by seed key; anything else the query found is listed as refused. */
export async function findSeeded(api, identity) {
  const ids = await api.wiql(candidateQuery(identity));
  const items = ids.length ? await api.getMany(ids) : [];
  const seeded = new Map();
  const refused = [];
  for (const item of items) {
    const key = seedKey(item, identity, api.project);
    if (key === null) refused.push(item.id);
    else if (seeded.has(key)) throw new SeedError(`Work items ${seeded.get(key).id} and ${item.id} both carry seed key ${key}.`, `Look at both in the board, and remove the one that shouldn't be there with cleanup.mjs --only ${item.id}.`);
    else seeded.set(key, item);
  }
  return { seeded, refused };
}

const add = (field, value) => ({ op: 'add', path: `/fields/${field}`, value });
const sub = (path) => path.replace('@project', '');
/** `@project\Sprint 1` as the project's own path. */
export const projectPath = (path, project) => `${project}${sub(path)}`;

/** A record's key, from its seed id. */
export const keyOf = (id) => id.slice(id.indexOf(':') + 1);

/**
 * The fields an OWI record is created with: everything but its timeline's
 * later moves, which apply.mjs makes as revisions afterwards, and its links,
 * which it adds last. A link writes a revision on both of its ends, dated
 * now, and Azure DevOps refuses a revision dated before the one already
 * there, so links can only follow the backdated history, never interleave
 * with it.
 */
export function createPatch(record, { project, identity, me, existingTags }) {
  const key = keyOf(record.id);
  const native = record.native['ado-seed generate'];
  const tags = identity === 'tags' ? record.labels : record.labels.filter((t) => existingTags.has(t.toLowerCase()));
  const first = native.timeline[0];
  const ops = [
    add('System.Title', identity === 'marker' ? `${TITLE_PREFIX}${record.title}` : record.title),
    add('System.Description', identity === 'marker' ? `${record.body.content}${markerOf(key)}` : record.body.content),
    add('System.AreaPath', projectPath(native.areaPath, project)),
    add('System.IterationPath', projectPath(first.iteration, project)),
    add('System.State', first.state),
    add('Microsoft.VSTS.Common.Priority', Number(record.priority)),
    ...(tags.length ? [add('System.Tags', tags.join('; '))] : []),
    ...(record.estimate ? [add(record.estimate.field, record.estimate.value)] : []),
    ...(record.assignee ? [add('System.AssignedTo', me)] : []),
    ...Object.entries(native.fields).map(([field, value]) => add(field, value)),
  ];
  return { ops, skippedTags: record.labels.filter((t) => !tags.includes(t)) };
}

/** The parent and link relations a record asks for that the work item doesn't have yet. Each pair is added from one end only: the child's for a parent, the predecessor's for a dependency. */
export function missingLinks(record, item, idOf, workItemUrl) {
  const have = new Set((item.relations ?? []).map((r) => `${r.rel} ${r.url?.match(/(\d+)$/)?.[1]}`));
  const out = [];
  const self = keyOf(record.id);
  const parent = record.parent ? idOf(keyOf(record.parent)) : undefined;
  if (parent !== undefined && !have.has(`System.LinkTypes.Hierarchy-Reverse ${parent}`)) out.push({ op: 'add', path: '/relations/-', value: { rel: 'System.LinkTypes.Hierarchy-Reverse', url: workItemUrl(parent) } });
  for (const link of record.links) {
    const other = keyOf(link.target);
    const target = idOf(other);
    if (target === undefined) continue;
    let rel = null;
    if (link.type === 'blocks' && link.direction === 'outward') rel = 'System.LinkTypes.Dependency-Forward';
    // Related has no direction, so the pair is added from the end whose key sorts first.
    else if (link.type === 'relates' && self < other) rel = 'System.LinkTypes.Related';
    if (rel && !have.has(`${rel} ${target}`)) out.push({ op: 'add', path: '/relations/-', value: { rel, url: workItemUrl(target) } });
  }
  return out;
}

/** The states a record passes through, in order, from its timeline. */
export const statesOf = (record) => record.native['ado-seed generate'].timeline.filter((e) => e.state).map((e) => e.state);

/** The states still to walk from where the item is to the record's last one; null when it is somewhere the walk doesn't pass. */
export function remainingStates(record, current) {
  const states = statesOf(record);
  const at = states.indexOf(current);
  return at === -1 ? null : states.slice(at + 1);
}
