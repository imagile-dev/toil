import { dirname } from 'node:path';
import { z } from 'zod';
import type { AnyArea } from '../core/area.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { connectionsOf, defaultConnectionName, loadConfig, type ResolvedConfig } from '../core/config.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { hostMatches, type Dossier, type DossierCatalog, type Section } from '../core/dossier.js';
import { ToilError, toToilError, withArticle } from '../core/errors.js';
import { forwardSlashes } from '../core/files.js';
import { addConnection, testConnection } from '../connections/commands.js';
import { refuseWritesBindings } from './build.js';
import { checkDossier, chosen } from './commands.js';

/**
 * `toil dossiers onboard [<dossier>]`: setting up a repository someone else
 * wrote a dossier for. For each area the dossier covers it finds the reader's
 * connection (by the section's `host`, its `connection` name, or the area's
 * default), offers to add one through `toil connections add` when there is
 * none, asks which to pin in the reader's own copy when several match, and
 * then runs `dossiers check` and one test read per connection.
 *
 * It asks for tokens, so it is a person's command: the CLI on a terminal, or
 * the API for a host that passes a `person`; never MCP. With no one to ask
 * (a pipe, CI, or `--plan`) it adds nothing and reports what each area
 * needs, with the command that would set it up. Onboarding used to be a
 * fortnight of tickets; it is now one command with the same number of forms.
 */

type Status = 'matched' | 'default' | 'created' | 'pinned' | 'missing' | 'ambiguous';

interface Target {
  area: AnyArea;
  env: string | undefined;
  /** The section's key path: `github`, or `environments.prod.openshift`. */
  path: string;
  section: Section;
}

interface Outcome {
  area: string;
  env: string | null;
  path: string;
  selects: { host: string } | { connection: string } | { default: true };
  status: Status;
  connection: string | null;
  candidates?: string[];
  problem?: { code: string; message: string; fix?: string };
  /** For a missing connection: the name and base URL `connections add` would be offered. */
  suggest?: { name: string; baseUrl?: string };
}

export function dossierOnboardCommands(areas: readonly AnyArea[]): AnyCommand[] {
  const onboard = defineConfigCommand({
    path: ['dossiers', 'onboard'],
    description: "Set up this repo: match each area of its dossier to your connections, add the ones you lack, then check it and test each",
    input: z.object({
      dossier: z.string().min(1).optional().describe('A dossier name, or the path to a dossier file. Defaults to the dossier that applies to the folder.'),
      cwd: z.string().min(1).optional().describe('The folder to look from; its repository decides which checked-in dossiers apply. Defaults to the workspace.'),
      plan: z.boolean().optional().describe('Ask nothing and add no connection: report what each area needs, then check and test what is there. A pin still applies.'),
      pin: z.array(z.string().min(1)).optional().describe("Where several of your connections match an area, the one your own copy of the dossier uses, each area=connection"),
    }),
    writes: false,
    // Adding a connection or pinning one writes config or your own dossier; a plan with no pin writes nothing.
    writesLocal: false,
    writesLocalWhen: (input) => !input.plan || (input.pin?.length ?? 0) > 0,
    // It asks for tokens: a person on a terminal, or a host's person through the API, never MCP.
    kind: 'cli-only',
    args: [{ name: 'dossier', field: 'dossier', description: 'A dossier name or file (default: the one the folder matches)', required: false }],
    options: [
      { flags: '--cwd <dir>', field: 'cwd', description: 'The folder to look from (default: the working directory)' },
      { flags: '--plan', field: 'plan', description: 'Ask nothing and add no connection; report what each area needs' },
      { flags: '--pin <area=connection>', field: 'pin', description: 'The connection your own copy uses where several match; repeatable' },
    ],
    examples: [{}, { dossier: 'payments', cwd: '.', plan: true }, { dossier: 'payments', pin: ['github=github-work'] }],
    run: async (input, ctx) => {
      const manage = ctx.manage!;
      const catalog = manage.dossiers;
      if (!catalog) throw new ToilError('NOT_CONFIGURED', 'Dossiers are not available here.', { fix: 'Run toil dossiers onboard from the CLI.' });
      const applied = chosen(catalog, input, ctx);
      const dossier = applied.file.dossier;
      const ask = input.plan ? undefined : manage.prompt;
      if (!input.plan && !manage.prompt) {
        ctx.warn({ code: 'ONBOARD_NO_TERMINAL', message: 'There is no terminal to ask on, so no connection was added: each area says what it needs. Run toil dossiers onboard in a terminal to add the missing ones.' });
      }
      const pins = pinsFrom(input.pin ?? [], areas, dossier, manage.config);
      let config = manage.config;
      const reload = () => (config = reloaded(manage, areas));

      const outcomes: Outcome[] = [];
      const toPin: Array<{ target: Target; connection: string }> = [];
      for (const target of targetsOf(dossier, areas)) {
        const outcome = match(config, target);
        if (outcome.status === 'missing' && ask) {
          const created = await offerConnection(ctx, ask, areas, config, dossier, target);
          if (created) {
            reload();
            Object.assign(outcome, { status: 'created', connection: created });
            delete outcome.problem;
          } else if (created === null) {
            outcome.problem = { code: 'CANCELLED', message: `No ${target.area.name} connection was added.`, fix: fixFor(dossier, target, config) };
          }
        }
        if (outcome.status === 'ambiguous') {
          const pick = pins.get(target.area.name) ?? (ask ? await askPin(ask, dossier, target, outcome.candidates!) : undefined);
          if (pick !== undefined) {
            toPin.push({ target, connection: pick });
            Object.assign(outcome, { status: 'pinned', connection: pick });
            delete outcome.problem;
          }
        }
        if (outcome.status === 'missing') {
          if (outcome.problem && !outcome.problem.fix) outcome.problem.fix = fixFor(dossier, target, config);
          outcome.suggest = suggestionFor(target, config);
        }
        if (outcome.status === 'ambiguous' && outcome.problem) outcome.problem.fix = `Run it in a terminal to choose, or pass --pin ${target.area.name}=<one of ${outcome.candidates!.join(', ')}>.`;
        outcomes.push(outcome);
      }
      for (const [area] of pins) {
        if (!toPin.some((p) => p.target.area.name === area)) ctx.warn({ code: 'ONBOARD_PIN_UNUSED', message: `--pin ${area}=... wasn't needed: only one of your ${area} connections matches, or none does.` });
      }
      const file = toPin.length ? pinInOwnCopy(ctx, catalog, manage, areas, applied.file, toPin) : applied.file;

      // dossiers check, against the config as it is now, then one test read per connection.
      const check = checkDossier(catalog, config, areas, file, input.cwd);
      const tested = new Map<string, { ok: boolean; request?: string | null; live?: boolean; error?: { code: string; message: string; fix?: string } }>();
      for (const name of [...new Set(outcomes.map((o) => o.connection).filter((n): n is string => n !== null))]) {
        try {
          const result = await testConnection(ctx, areas, config, name);
          tested.set(name, { ok: true, request: result.request, live: result.live });
        } catch (err) {
          const e = toToilError(err);
          tested.set(name, { ok: false, error: { code: e.code, message: e.message, ...(e.fix ? { fix: e.fix } : {}) } });
        }
      }
      const areasOut = outcomes.map((o) => ({ ...o, test: o.connection === null ? null : tested.get(o.connection)! }));
      const ok = check.ok && areasOut.every((a) => a.connection !== null && a.test?.ok === true);
      if (!ok) ctx.setExitCode(1);
      return {
        dossier: { name: dossier.name, source: applied.file.source, file: forwardSlashes(applied.file.file) },
        ownCopy: file === applied.file ? null : forwardSlashes(file.file),
        plan: ask === undefined,
        ok,
        areas: areasOut,
        check,
      };
    },
  });
  return [onboard];
}

/** Every section that picks a connection for an area toil has: the area's own, then each environment's. */
function targetsOf(dossier: Dossier, areas: readonly AnyArea[]): Target[] {
  const byName = new Map(areas.map((a) => [a.name, a]));
  const out: Target[] = [];
  for (const [name, section] of Object.entries(dossier.sections)) {
    const area = byName.get(name);
    if (area) out.push({ area, env: undefined, path: name, section });
  }
  for (const [env, byArea] of Object.entries(dossier.environments)) {
    for (const [name, section] of Object.entries(byArea)) {
      const area = byName.get(name);
      if (area) out.push({ area, env, path: `environments.${env}.${name}`, section });
    }
  }
  return out;
}

/** What a call would find for one section, as core's resolver chooses: the named connection, the one on the host, or the area's default. */
function match(config: ResolvedConfig, t: Target): Outcome {
  const base = { area: t.area.name, env: t.env ?? null, path: t.path };
  const named = typeof t.section.connection === 'string' ? t.section.connection : undefined;
  const host = typeof t.section.host === 'string' ? t.section.host : undefined;
  if (named !== undefined) {
    const found = config.connections[named]?.area === t.area.name;
    return {
      ...base,
      selects: { connection: named },
      status: found ? 'matched' : 'missing',
      connection: found ? named : null,
      ...(found ? {} : { problem: { code: 'NOT_CONFIGURED', message: `You have no ${t.area.name} connection named ${named}.` } }),
    };
  }
  if (host !== undefined) {
    const matches = connectionsOf(config, t.area.name).filter((n) => hostMatches(config.connections[n]!, host, t.area.siteApis));
    if (matches.length === 1) return { ...base, selects: { host }, status: 'matched', connection: matches[0]! };
    if (matches.length === 0) return { ...base, selects: { host }, status: 'missing', connection: null, problem: { code: 'NOT_CONFIGURED', message: `You have no ${t.area.name} connection on ${host}.` } };
    return { ...base, selects: { host }, status: 'ambiguous', connection: null, candidates: matches.sort(), problem: { code: 'INVALID_INPUT', message: `${matches.length} of your ${t.area.name} connections are on ${host}: ${matches.join(', ')}.` } };
  }
  const fallback = defaultConnectionName(config, t.area.name);
  if (fallback !== undefined) return { ...base, selects: { default: true }, status: 'default', connection: fallback };
  const all = connectionsOf(config, t.area.name).sort();
  if (all.length > 1) return { ...base, selects: { default: true }, status: 'ambiguous', connection: null, candidates: all, problem: { code: 'INVALID_INPUT', message: `You have ${all.length} ${t.area.name} connections and no default: ${all.join(', ')}.` } };
  return { ...base, selects: { default: true }, status: 'missing', connection: null, problem: { code: 'NOT_CONFIGURED', message: `You have no ${t.area.name} connection.` } };
}

/** The base URL to offer for a host: the API the area names for it (github.com's is api.github.com), else the host itself. */
export function suggestedBaseUrl(area: AnyArea, host: string): string {
  return Object.hasOwn(area.siteApis ?? {}, host) ? area.siteApis![host]! : `https://${host}`;
}

function freeName(config: ResolvedConfig, area: string): string {
  if (!config.connections[area]) return area;
  for (let i = 2; ; i++) if (!config.connections[`${area}-${i}`]) return `${area}-${i}`;
}

/** What `connections add` would be offered for a missing section: its name, and a base URL on its host. */
function suggestionFor(t: Target, config: ResolvedConfig): { name: string; baseUrl?: string } {
  const host = typeof t.section.host === 'string' ? t.section.host : undefined;
  return { name: typeof t.section.connection === 'string' ? t.section.connection : freeName(config, t.area.name), ...(host ? { baseUrl: suggestedBaseUrl(t.area, host) } : {}) };
}

/** The command that sets up what a missing section needs, for the report. */
function fixFor(dossier: Dossier, t: Target, config: ResolvedConfig): string {
  const named = typeof t.section.connection === 'string' ? t.section.connection : undefined;
  const host = typeof t.section.host === 'string' ? t.section.host : undefined;
  const name = named ?? freeName(config, t.area.name);
  return `Run toil dossiers onboard ${dossier.name} in a terminal, or toil connections add ${name} --area ${t.area.name}${host ? ` with a base URL on ${host} (${suggestedBaseUrl(t.area, host)})` : ''}.`;
}

/**
 * Asks whether to add the missing connection, and adds it through `toil
 * connections add`'s own flow, its settings offered from the dossier's host.
 * The connection's name, or null when the person said no or it wasn't saved.
 */
async function offerConnection(ctx: CommandContext<unknown>, ask: NonNullable<ConfigAccess['prompt']>, areas: readonly AnyArea[], config: ResolvedConfig, dossier: Dossier, t: Target): Promise<string | null> {
  const named = typeof t.section.connection === 'string' ? t.section.connection : undefined;
  const host = typeof t.section.host === 'string' ? t.section.host : undefined;
  const where = host ? ` on ${host}` : named ? ` named ${named}` : '';
  const yes = await ask.ask(`Dossier ${dossier.name}'s ${t.path} needs ${withArticle(t.area.name)} connection${where}, and you have none. Add one now? y/n`, 'y', `create:${t.path}`);
  if (!/^y(es)?$/i.test(yes)) return null;
  const name = named ?? (await ask.ask(`Name for the new ${t.area.name} connection`, freeName(config, t.area.name), `name:${t.path}`));
  try {
    await addConnection(ctx, areas, { name, area: t.area.name }, host ? { suggest: { baseUrl: suggestedBaseUrl(t.area, host) }, host } : {});
    return name;
  } catch (err) {
    const e = toToilError(err);
    ctx.warn({ code: 'ONBOARD_NOT_ADDED', message: `${t.path}: ${e.message}${e.fix ? ` ${e.fix}` : ''}` });
    return null;
  }
}

async function askPin(ask: NonNullable<ConfigAccess['prompt']>, dossier: Dossier, t: Target, candidates: string[]): Promise<string | undefined> {
  const answer = await ask.ask(`Several of your ${t.area.name} connections fit dossier ${dossier.name}'s ${t.path}: ${candidates.join(', ')}. Which should your own copy of it use?`, candidates[0], `pin:${t.path}`);
  if (candidates.includes(answer)) return answer;
  throw new ToilError('INVALID_INPUT', `"${answer}" isn't one of ${candidates.join(', ')}. Nothing was pinned.`, { fix: `Run it again and give one of them, or pass --pin ${t.area.name}=<connection>.` });
}

/** `--pin area=connection`, each naming an area the dossier covers and one of your connections to it. */
function pinsFrom(values: readonly string[], areas: readonly AnyArea[], dossier: Dossier, config: ResolvedConfig): Map<string, string> {
  const covered = new Set(targetsOf(dossier, areas).map((t) => t.area.name));
  const pins = new Map<string, string>();
  for (const value of values) {
    const at = value.indexOf('=');
    const area = value.slice(0, at);
    const name = value.slice(at + 1);
    if (at <= 0 || name === '') throw new ToilError('INVALID_INPUT', `--pin takes area=connection, and "${value}" isn't.`, { fix: 'For example --pin github=github-work.' });
    if (!covered.has(area)) throw new ToilError('INVALID_INPUT', `Dossier ${dossier.name} has no ${area} section to pin.`, { fix: `It covers: ${[...covered].join(', ') || 'no areas'}.` });
    if (config.connections[name]?.area !== area) throw new ToilError('INVALID_INPUT', `You have no ${area} connection named ${name}.`, { fix: `Run toil connections list --area ${area} to see yours.` });
    pins.set(area, name);
  }
  return pins;
}

/**
 * Writes the pinned connections into the reader's own copy of the dossier:
 * the dossier itself when it is already theirs, else their copy of the same
 * name, else a new copy in ~/.toil/dossiers. A copy there is adopted: it
 * applies wherever the shared one does, and writes may follow its bindings,
 * so outside the CLI one that selects a connection with writes on is refused,
 * as `dossiers import` refuses it.
 */
function pinInOwnCopy(ctx: CommandContext<unknown>, catalog: DossierCatalog, manage: ConfigAccess, areas: readonly AnyArea[], from: { file: string; source: string; dossier: Dossier }, pins: Array<{ target: Target; connection: string }>) {
  const mine = from.source === 'user' ? from : catalog.scan().files.find((f) => f.source === 'user' && f.dossier?.name === from.dossier.name);
  const dossier = structuredClone(mine?.dossier ?? from.dossier);
  for (const { target, connection } of pins) {
    const holder = target.env === undefined ? dossier.sections : (dossier.environments[target.env] ??= {});
    const section: Section = { ...(holder[target.area.name] ?? {}) };
    delete section.host;
    section.connection = connection;
    holder[target.area.name] = section;
  }
  if (manage.via !== 'cli') refuseWritesBindings(catalog, manage.config, areas, dossier, 'import');
  const path = mine?.file ?? catalog.userFile(dossier.name);
  const written = catalog.save(path, dossier, mine ? 'edit' : 'create');
  if (!mine) {
    ctx.warn({ code: 'ONBOARD_OWN_COPY', message: `Your own copy of ${dossier.name}, ${written}, now applies wherever the shared one does. It is yours, so writes may follow its bindings; toil dossiers remove ${dossier.name} takes it away.` });
  }
  return catalog.find(written);
}

/** The config as the next call will load it, after `connections add` changed the file. */
function reloaded(manage: ConfigAccess, areas: readonly AnyArea[]): ResolvedConfig {
  const path = manage.config.files.global;
  return loadConfig({
    env: manage.env,
    cwd: dirname(path),
    home: dirname(dirname(path)),
    configPath: path,
    areas: areas.map((a) => ({ name: a.name, fallbacks: a.fallbacks, contextInputs: Object.keys(a.context), ...(a.siteApis ? { siteApis: a.siteApis } : {}) })),
  });
}
