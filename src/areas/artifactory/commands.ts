import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { allowWriteField } from '../../core/run.js';
import { artifactoryArea } from './area.js';
import { artifactory, ping } from './client.js';

/**
 * The nine Artifactory commands: health, repositories, artifact metadata and
 * properties, AQL search, and Build Integration. `data` is Artifactory's own
 * answer, except where noted (`builds` derives names; `properties-set`
 * reports what it asked for). Repo and path go into the URL as typed, and AQL
 * values into the query as typed, both suspected bugs (#82) kept until a
 * live server rules on them, as rulings tend to be scheduled.
 */

/** A number the contract read with parseInt: text stays text until then. */
const intText = z.union([z.number(), z.string()]);

/** One leading slash goes; the rest of the path is sent as typed (suspected bug #82 item 4: no encoding). */
const storagePath = (repo: string, path: string) => `api/storage/${repo}/${path.startsWith('/') ? path.slice(1) : path}`;

export const pingCommand = artifactoryArea.command({
  path: ['artifactory', 'ping'],
  description: 'Check Artifactory connectivity and authentication',
  toolDescription: "Check Artifactory answers and accepts the token. Returns Artifactory's own text (normally \"OK\") as data.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => ping(ctx),
});

export const reposCommand = artifactoryArea.command({
  path: ['artifactory', 'repos'],
  description: 'List repositories',
  input: z.object({
    type: z.string().optional().describe('Filter by type: local, virtual, remote, federated'),
    packageType: z.string().optional().describe('Filter by package type: npm, maven, nuget, docker, pypi, etc.'),
  }),
  writes: false,
  options: [
    { flags: '--type <type>', field: 'type', description: 'Filter by type: local, virtual, remote, federated' },
    { flags: '--package-type <type>', field: 'packageType', description: 'Filter by package type: npm, maven, nuget, docker, pypi, etc.' },
  ],
  examples: [{}, { type: 'local', packageType: 'npm' }],
  // Neither filter is checked here; Artifactory decides what a type is.
  run: async (input, ctx) => artifactory(ctx, 'api/repositories', { query: { type: input.type, packageType: input.packageType } }),
});

export const artifactInfoCommand = artifactoryArea.command({
  path: ['artifactory', 'artifact-info'],
  description: 'Get metadata for an artifact or folder (checksums, size, timestamps)',
  input: z.object({
    repo: z.string().describe('Repository key'),
    path: z.string().describe('Path of the artifact or folder inside the repository'),
  }),
  writes: false,
  args: [
    { name: 'repo', field: 'repo', description: 'Repository key' },
    { name: 'path', field: 'path', description: 'Path of the artifact or folder inside the repository' },
  ],
  examples: [{ repo: 'libs-release-local', path: 'dev/imagile/api/1.4.0/api-1.4.0.jar' }, { repo: 'libs-release-local', path: '/dev/imagile/api' }],
  run: async (input, ctx) => artifactory(ctx, storagePath(input.repo, input.path)),
});

export const propertiesGetCommand = artifactoryArea.command({
  path: ['artifactory', 'properties-get'],
  description: 'Read custom properties on an artifact',
  input: z.object({
    repo: z.string().describe('Repository key'),
    path: z.string().describe('Path of the artifact or folder inside the repository'),
  }),
  writes: false,
  args: [
    { name: 'repo', field: 'repo', description: 'Repository key' },
    { name: 'path', field: 'path', description: 'Path of the artifact or folder inside the repository' },
  ],
  examples: [{ repo: 'libs-release-local', path: 'dev/imagile/api/1.4.0/api-1.4.0.jar' }],
  run: async (input, ctx) => artifactory(ctx, storagePath(input.repo, input.path), { query: { properties: '' } }),
});

export const propertiesSetCommand = artifactoryArea.command({
  path: ['artifactory', 'properties-set'],
  description: 'Set custom properties on an artifact (format: key=value key=value...)',
  input: z.object({
    repo: z.string().describe('Repository key'),
    path: z.string().describe('Path of the artifact or folder inside the repository'),
    keyvals: z.array(z.string()).optional().describe('Properties to set, each key=value'),
    recursive: z.boolean().optional().describe('Apply recursively to folder contents (default: false)'),
    ...allowWriteField,
  }),
  writes: true,
  args: [
    { name: 'repo', field: 'repo', description: 'Repository key' },
    { name: 'path', field: 'path', description: 'Path of the artifact or folder inside the repository' },
    { name: 'keyvals', field: 'keyvals', description: 'Properties to set, each key=value', required: false, variadic: true },
  ],
  options: [{ flags: '--recursive', field: 'recursive', description: 'Apply recursively to folder contents (default: false)' }],
  examples: [
    { repo: 'libs-release-local', path: 'dev/imagile/api/1.4.0/api-1.4.0.jar', keyvals: ['qa.status=passed', 'build.ticket=ABC-123'], allowWrite: true },
    { repo: 'libs-release-local', path: '/dev/imagile/api', keyvals: ['retention=keep'], recursive: true, allowWrite: true },
  ],
  run: async (input, ctx) => {
    const keyvals = input.keyvals ?? [];
    if (!keyvals.length) {
      throw new ToilError('INVALID_INPUT', 'Provide at least one key=value pair', { fix: 'Pass the properties to set after the path, e.g. toil artifactory properties-set <repo> <path> qa.status=passed.' });
    }
    const properties: Record<string, string> = {};
    for (const kv of keyvals) {
      const eq = kv.indexOf('=');
      if (eq < 1) throw new ToilError('INVALID_INPUT', `Invalid property format: "${kv}" — expected key=value`, { fix: 'Write each property as key=value, with a key before the first "=".' });
      properties[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    // Suspected bug #82 item 2: values go in unescaped, so a comma makes several values and a ";" another property.
    const propString = Object.entries(properties)
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    // Suspected bug #82 item 1: without --recursive nothing is sent, so a folder takes Artifactory's default, which is recursive.
    await artifactory(ctx, storagePath(input.repo, input.path), { method: 'PUT', query: { properties: propString, ...(input.recursive ? { recursive: 1 } : {}) } });
    // What was asked for, not what Artifactory stored; it answers a PUT with nothing.
    return { repo: input.repo, path: input.path, properties };
  },
});

export const searchCommand = artifactoryArea.command({
  path: ['artifactory', 'search'],
  description: 'Search artifacts using AQL (Artifactory Query Language) (consider --output-file for large results)',
  toolDescription: 'Search artifacts with AQL, newest first, by repository key, name pattern or path pattern (at least one), optionally by creation date. Returns { results, range }.',
  input: z.object({
    repo: z.string().optional().describe('Filter by repository key'),
    name: z.string().optional().describe('Filter by artifact name (supports * and ? wildcards)'),
    path: z.string().optional().describe('Filter by artifact path (supports * and ? wildcards)'),
    after: z.string().optional().describe('Created after this date (ISO 8601, e.g. 2024-01-01)'),
    before: z.string().optional().describe('Created before this date (ISO 8601)'),
    limit: intText.optional().describe('Maximum results to return (default: 100)'),
    properties: z.boolean().optional().describe('Include artifact properties in results (default: false)'),
  }),
  writes: false,
  // AQL goes in a POST body; nothing is changed by asking.
  queryByPost: true,
  options: [
    { flags: '--repo <name>', field: 'repo', description: 'Filter by repository key' },
    { flags: '--name <pattern>', field: 'name', description: 'Filter by artifact name (supports * and ? wildcards)' },
    { flags: '--path <pattern>', field: 'path', description: 'Filter by artifact path (supports * and ? wildcards)' },
    { flags: '--after <date>', field: 'after', description: 'Created after this date (ISO 8601, e.g. 2024-01-01)' },
    { flags: '--before <date>', field: 'before', description: 'Created before this date (ISO 8601)' },
    { flags: '--limit <n>', field: 'limit', description: 'Maximum results to return (default: 100)' },
    { flags: '--properties', field: 'properties', description: 'Include artifact properties in results (default: false)' },
  ],
  examples: [
    { repo: 'libs-release-local' },
    { repo: 'libs-release-local', name: 'api-*.jar', path: 'dev/imagile/*', after: '2026-01-01', before: '2026-10-01', limit: '5', properties: true },
  ],
  run: async (input, ctx) => {
    if (!input.repo && !input.name && !input.path) {
      throw new ToilError('INVALID_INPUT', 'Provide at least one filter: --repo, --name, or --path', { fix: 'Add --repo <key>, --name <pattern> or --path <pattern> to the search.' });
    }
    const parsed = parseInt(String(input.limit ?? '100'), 10);
    const limit = Number.isNaN(parsed) ? 100 : parsed;
    return artifactory(ctx, 'api/search/aql', { method: 'POST', body: aql({ ...input, limit }), headers: { 'Content-Type': 'text/plain' } });
  },
});

/**
 * The AQL query, built as the contract built it. Suspected bugs (#82):
 * values are not escaped (item 5), `--properties` asks for a "properties"
 * include AQL may not know (item 3), and a limit of 0 means 100 (item 6).
 */
export function aql(opts: { repo?: string | undefined; name?: string | undefined; path?: string | undefined; after?: string | undefined; before?: string | undefined; limit: number; properties?: boolean | undefined }): string {
  const criteria: string[] = [];
  if (opts.repo) criteria.push(`"repo": {"$eq": "${opts.repo}"}`);
  if (opts.name) criteria.push(`"name": {"$match": "${opts.name}"}`);
  if (opts.path) criteria.push(`"path": {"$match": "${opts.path}"}`);
  if (opts.after) criteria.push(`"created": {"$gt": "${opts.after}"}`);
  if (opts.before) criteria.push(`"created": {"$lt": "${opts.before}"}`);
  const find = criteria.length > 0 ? `{${criteria.join(',')}}` : '{}';
  const include = opts.properties
    ? '.include("repo","path","name","type","size","created","modified","sha256","properties")'
    : '.include("repo","path","name","type","size","created","modified","sha256")';
  const limit = opts.limit ? `.limit(${opts.limit})` : '.limit(100)';
  return `items.find(${find})${include}.sort({"$desc": ["created"]})${limit}`;
}

export const buildsCommand = artifactoryArea.command({
  path: ['artifactory', 'builds'],
  description: 'List builds registered in Artifactory Build Integration (names may differ from ADO pipeline names; use "search --repo" when empty)',
  input: z.object({
    timeout: intText.optional().describe('Request timeout in seconds (default 60; increase for large Artifactory instances)'),
  }),
  writes: false,
  // Room for a long --timeout: the request's own limit is the one that should end it.
  timeLimitMs: 600_000,
  options: [{ flags: '--timeout <s>', field: 'timeout', description: 'Request timeout in seconds (default 60; increase for large Artifactory instances)' }],
  examples: [{}, { timeout: '90' }],
  run: async (input, ctx) => {
    const timeoutSecs = parseInt(String(input.timeout ?? '60'), 10);
    if (isNaN(timeoutSecs) || timeoutSecs <= 0) {
      throw new ToilError('INVALID_INPUT', '--timeout must be a positive integer (seconds)', { fix: 'Pass --timeout <seconds>, a whole number above 0, or leave it out for 60.' });
    }
    const raw = await artifactory<{ builds?: Array<{ uri: string; lastStarted: string }>; uri: string }>(ctx, 'api/build', { timeoutMs: timeoutSecs * 1000 });
    // Suspected bug #82 item 7: the name is the uri with its slashes trimmed, never decoded.
    const builds = (raw.builds ?? []).map((b) => ({ name: b.uri.replace(/^\/|\/$/g, ''), uri: b.uri, lastStarted: b.lastStarted }));
    const result: { builds: typeof builds; uri: string; hint?: string } = { builds, uri: raw.uri };
    if (builds.length === 0) {
      result.hint =
        'No builds are registered in Artifactory Build Integration. Build names may differ from ADO pipeline names. Use "artifactory repos" to list repositories, then "artifactory search --repo <repo>" to locate artifacts directly.';
    }
    return result;
  },
});

export const buildRunsCommand = artifactoryArea.command({
  path: ['artifactory', 'build-runs'],
  description: 'List all run numbers for a build',
  input: z.object({
    name: z.string().describe('Build name, as builds lists it'),
  }),
  writes: false,
  args: [{ name: 'name', field: 'name', description: 'Build name, as builds lists it' }],
  examples: [{ name: 'imagile-api' }, { name: 'imagile api/main' }],
  run: async (input, ctx) => artifactory(ctx, `api/build/${encodeURIComponent(input.name)}`),
});

export const buildInfoCommand = artifactoryArea.command({
  path: ['artifactory', 'build-info'],
  description: 'Get build info (artifacts, dependencies, VCS revision) for a specific run',
  input: z.object({
    name: z.string().describe('Build name, as builds lists it'),
    number: z.string().describe('Run number, as build-runs lists it'),
  }),
  writes: false,
  args: [
    { name: 'name', field: 'name', description: 'Build name, as builds lists it' },
    { name: 'number', field: 'number', description: 'Run number, as build-runs lists it' },
  ],
  examples: [{ name: 'imagile-api', number: '142' }],
  run: async (input, ctx) => artifactory(ctx, `api/build/${encodeURIComponent(input.name)}/${encodeURIComponent(input.number)}`),
});

export const artifactoryCommands = [pingCommand, reposCommand, artifactInfoCommand, propertiesGetCommand, propertiesSetCommand, searchCommand, buildsCommand, buildRunsCommand, buildInfoCommand];
