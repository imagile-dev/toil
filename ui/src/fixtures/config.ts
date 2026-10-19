/**
 * The settings pages' sample data, for the site preview and `toil-ui
 * --sample`: what `toil connections list`, `dossiers list`, `dossiers show`,
 * `dossiers check` and `connections test` print for the preview's own
 * connections and dossiers, and the areas' connection fields as the registry
 * describes them (config-areas.json, which test/config.test.ts holds equal to
 * the real registry). Every change is refused, saying why: the preview has
 * no configuration to change, so nothing on these pages changes anything.
 *
 * The connections are the ones the preview's dossiers name. `github` is made
 * by env vars alone, the way CI defines one, so the pages show it read-only.
 * A sandbox with the furniture glued down.
 */

import { CONFIG_COMMANDS, CONFIG_READS, DEFAULT_TIMEOUT_MS, type AreaInfo, type ConfigApi, type ConnectionsData, type SettingsInfo } from '../config.ts';
import type { Envelope } from '../toil.ts';
import AREAS from './config-areas.json' with { type: 'json' };
import { DOSSIERS, fileOf, listData, showData } from './dossiers.ts';
import { callKey } from './execute.ts';

const VERSION = '0.1.0-alpha.1';
const CONFIG_FILE = '/home/you/.toil/config.json';

/** Why the preview's settings pages change nothing, said beside every action. */
export const PREVIEW_DISABLED = 'This is the preview, on sample data: it has no configuration of yours to change, so every action here is turned off. In Toil UI on your own machine, these run toil\'s own commands.';

export const FIXTURE_AREAS: AreaInfo[] = AREAS as AreaInfo[];

export const FIXTURE_CONNECTIONS: ConnectionsData = {
  configFile: CONFIG_FILE,
  connections: [
    { name: 'corp-ado', area: 'ado', isDefault: true, host: 'ado.imagile.dev', writes: false, values: { baseUrl: 'file', collection: 'file', pat: 'store' }, definedIn: 'file' },
    { name: 'corp-bitbucket', area: 'bitbucket', isDefault: true, host: 'bitbucket.imagile.dev', writes: false, values: { baseUrl: 'file', pat: 'store' }, definedIn: 'file' },
    { name: 'corp-jenkins', area: 'jenkins', isDefault: true, host: 'jenkins.imagile.dev', writes: false, values: { baseUrl: 'file', username: 'file', apiToken: 'store' }, definedIn: 'file' },
    { name: 'corp-jira', area: 'jira', isDefault: true, host: 'jira.imagile.dev', writes: true, values: { baseUrl: 'file', apiToken: 'store', writes: 'file' }, definedIn: 'file' },
    { name: 'github', area: 'github', isDefault: true, host: 'ghe.imagile.dev', writes: false, values: { baseUrl: 'env', token: 'ci' }, definedIn: 'env' },
    { name: 'ocp-nonprod', area: 'openshift', isDefault: true, host: 'api.ocp-nonprod.imagile.dev:6443', writes: false, values: { baseUrl: 'file', env: 'file', token: 'store' }, definedIn: 'file' },
    { name: 'ocp-prod', area: 'openshift', isDefault: false, host: 'api.ocp-prod.imagile.dev:6443', writes: false, values: { baseUrl: 'file', env: 'file', token: 'store' }, definedIn: 'file' },
  ],
};

const PROBES: Record<string, string> = {
  ado: 'GET /_apis/connectionData',
  bitbucket: 'GET /rest/api/1.0/users',
  jenkins: 'GET /me/api/json',
  jira: 'GET /rest/api/2/myself',
  github: 'GET /user',
  openshift: 'GET /version',
};

interface Answer {
  command: string;
  input: Record<string, unknown>;
  data: unknown;
}

export const CONFIG_CANNED: Answer[] = [
  { command: 'connections list', input: {}, data: FIXTURE_CONNECTIONS },
  { command: 'dossiers list', input: {}, data: listData() },
  ...DOSSIERS.map((d) => ({ command: 'dossiers show', input: { dossier: d.name }, data: showData(d) })),
  ...DOSSIERS.map((d) => ({ command: 'dossiers check', input: { dossier: d.name }, data: { name: d.name, file: fileOf(d.name), source: 'user', ok: true, problems: [] } })),
  ...FIXTURE_CONNECTIONS.connections.map((c) => ({
    command: 'connections test',
    input: { name: c.name },
    data: { name: c.name, area: c.area, host: c.host, live: true, authenticated: true, request: PROBES[c.area] ?? null },
  })),
];

const meta = (command: string) => ({ command, durationMs: 0, version: VERSION, contractVersion: 1 });

/** The preview's config: reads from CONFIG_CANNED, every change refused with the reason. */
export function fixtureConfig(canned: Answer[] = CONFIG_CANNED): ConfigApi & { calls: Array<{ command: string; input: Record<string, unknown> }> } {
  const answers = new Map(canned.map((c) => [callKey(c.command, c.input), c]));
  const calls: Array<{ command: string; input: Record<string, unknown> }> = [];
  const reads = new Set<string>(CONFIG_READS);
  return {
    disabled: PREVIEW_DISABLED,
    calls,
    areas: async () => structuredClone(FIXTURE_AREAS),
    settings: async (): Promise<SettingsInfo> => ({ timeout: { variable: 'TOIL_TIMEOUT_MS', value: null, effectiveMs: DEFAULT_TIMEOUT_MS, defaultMs: DEFAULT_TIMEOUT_MS } }),
    run: async (command, input) => {
      calls.push({ command, input });
      await Promise.resolve();
      return structuredClone(fixtureConfigAnswer(answers, reads, command, input));
    },
  };
}

function fixtureConfigAnswer(answers: Map<string, Answer>, reads: Set<string>, command: string, input: Record<string, unknown>): Envelope {
  if (!CONFIG_COMMANDS.has(command)) {
    return { ok: false, data: null, error: { code: 'INVALID_INPUT', message: `Toil UI doesn't change ${command} from the page.`, fix: `Run toil ${command} on the CLI, where toil's own rules apply.` }, meta: meta(command) };
  }
  if (!reads.has(command)) {
    return { ok: false, data: null, error: { code: 'WRITE_DISABLED', message: `The preview changes nothing, so toil ${command} didn't run.`, fix: 'Run Toil UI on your own machine to change your configuration.' }, meta: meta(command) };
  }
  const hit = answers.get(callKey(command, input));
  if (!hit) {
    return { ok: false, data: null, error: { code: 'INVALID_INPUT', message: `The preview has no sample answer for ${callKey(command, input)}.`, fix: 'Add the call to CONFIG_CANNED in ui/src/fixtures/config.ts.' }, meta: meta(command) };
  }
  return { ok: true, data: hit.data, error: null, meta: meta(command) };
}

/** The same answers as a Store's `execute()` would give them, for `toil-ui --sample` (ui/server/store.ts). */
export function fixtureConfigExecute(): (command: string, input: Record<string, unknown>) => Promise<Envelope> {
  const answers = new Map(CONFIG_CANNED.map((c) => [callKey(c.command, c.input), c]));
  const reads = new Set<string>(CONFIG_READS);
  return async (command, input) => structuredClone(fixtureConfigAnswer(answers, reads, command, input));
}
