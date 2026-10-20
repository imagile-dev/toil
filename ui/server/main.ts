/**
 * `toil-ui`, the bin (dist/server/toil-ui.js once built). It reads the
 * settings, picks the Store and Agent (the SQLite cache a sync fills through
 * toil's own `execute()`, and the agent adapter chosen in Settings, #251; or
 * the sample pair, fixtures and the scripted agent, with `--sample`),
 * starts the server on loopback and
 * prints the one URL that opens it, once. It opens no browser: that would mean
 * spawning a program, and the URL is right there. Ctrl+C stops it. The whole
 * onboarding process, minus the onboarding. `toil-ui wipe` deletes the cache
 * and exits. The worklog (#308) is folded again at start, after every sync
 * job, and after each agent question's start and end.
 */

import { execute, mapOwi, registry, contractVersion as toilContract, version as toilVersion } from '@imagile-dev/toil/api';
import { fileURLToPath } from 'node:url';
import { FIXTURE_AREAS } from '../src/fixtures/config.ts';
import { fixtureAgent, noAgent } from './agent.ts';
import { AgentHost } from './agents/host.ts';
import { cacheData } from './agents/tools.ts';
import { Cache, CacheError, wipeCacheFiles } from './cache.ts';
import { areasFrom, settingsFrom } from './config.ts';
import { createUiServer, type DossierRenames } from './server.ts';
import { parseSettings, SettingsError, themesNotice, USAGE } from './settings.ts';
import { fixtureStore, sqliteStore } from './store.ts';
import { SyncService } from './sync.ts';
import { WorklogService } from './worklog.ts';
import { fixtureWorklog } from '../src/fixtures/worklog.ts';
import { cacheLedger, memoryLedger, usageControl } from './usage.ts';
import { SAMPLE_USAGE_SETTINGS, sampleUsageRecords } from '../src/fixtures/model-usage.ts';
import { FIXTURE_NOW } from '../src/fixtures/execute.ts';
import { randomUUID } from 'node:crypto';
import { actorOf } from '../src/assign/model.ts';
import { AssignmentQueue } from '../src/assign/queue.ts';
import { readPeople } from '../src/model/people.ts';
import { sampleQueue } from '../src/fixtures/assignments.ts';
import { checkAssignSettings, fileKeeper, queueSettings, saveAssignSettings } from './assign/files.ts';
import { hostRunner, reposOf } from './assign/runner.ts';
import type { AssignmentControl } from './assign/routes.ts';
import { CALLER } from './store.ts';
import type { Execute } from '../src/toil.ts';

declare const __TOIL_UI_VERSION__: string;

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseSettings(process.argv.slice(2), process.env);
  } catch (e) {
    if (e instanceof SettingsError) {
      process.stderr.write(`toil-ui: ${e.message}\n  Fix: ${e.fix}\n`);
      return 2;
    }
    throw e;
  }
  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.version) {
    process.stdout.write(`${__TOIL_UI_VERSION__} (toil ${toilVersion})\n`);
    return 0;
  }

  const { settings } = parsed;
  if (parsed.command === 'wipe') {
    try {
      const paths = wipeCacheFiles(settings.dataDir);
      process.stdout.write(`Wiped Toil UI's cache: ${paths.dir} and everything a sync stored in it are gone. The next sync fetches everything again.\n`);
      return 0;
    } catch (e) {
      if (e instanceof CacheError) {
        process.stderr.write(`toil-ui: ${e.message}\n  Fix: ${e.fix}\n`);
        return 1;
      }
      throw e;
    }
  }

  // The cache and its sync, unless this is the sample: that reads the fixtures, and stores nothing.
  let cache: Cache | undefined;
  let sync: SyncService | undefined;
  let worklog: WorklogService | undefined;
  if (!settings.sample) {
    try {
      cache = await Cache.open(settings.dataDir, { retentionDays: settings.retentionDays });
    } catch (e) {
      if (e instanceof CacheError) {
        process.stderr.write(`toil-ui: ${e.message}\n  Fix: ${e.fix}\n`);
        return 1;
      }
      throw e;
    }
    worklog = new WorklogService({ cache: () => cache!, execute });
    const pages = worklog;
    sync = new SyncService({ cache, execute, mapOwi, onFinished: () => pages.reconcileAll() });
    // The cache pruned what outlived its retention as it opened; the pages follow it.
    await worklog.reconcileAll().catch((e: unknown) => process.stderr.write(`toil-ui: couldn't fold the worklog pages again: ${e instanceof Error ? e.message : String(e)}\n`));
  }
  const toil = { version: toilVersion, contractVersion: toilContract };
  // The agent (#251): the adapter chosen in Settings, reading the cache, or the scripted one for the sample.
  // The agent's model usage (#295): the cache's ledger, or the sample month, read-only, with --sample.
  const ledger = cache ? cacheLedger(() => cache!) : memoryLedger(sampleUsageRecords());
  const usage = cache
    ? usageControl({ dataDir: settings.dataDir, ledger, retentionDays: settings.retentionDays })
    : usageControl({ dataDir: settings.dataDir, ledger, retentionDays: null, sample: SAMPLE_USAGE_SETTINGS, now: () => new Date(FIXTURE_NOW) });
  let serveTools: ConstructorParameters<typeof AgentHost>[0]['serveTools'] = () => {
    throw new Error('The server is not listening yet.');
  };
  const mapIds = (envelope: Parameters<typeof mapOwi>[0]) => {
    try {
      // An older toil maps no changes; its items still vouch for what they name.
      const mapped = mapOwi(envelope) as { items: Array<{ id: string }>; changes?: Array<{ id: string }> };
      return [...mapped.items, ...(mapped.changes ?? [])].map((r) => r.id);
    } catch {
      return [];
    }
  };
  const host = cache
    ? new AgentHost({
        dataDir: settings.dataDir,
        version: __TOIL_UI_VERSION__,
        data: (dossier) => {
          const data = cacheData(cache!, dossier);
          return data && worklog ? { ...data, worklog: async (day) => (await worklog!.day(dossier, day)).page, standup: async (from, to) => (await worklog!.standup(dossier, from, to)).report } : data;
        },
        onRun: (run) => worklog?.recordRun(run),
        registry: registry.commands,
        execute,
        mapIds,
        serveTools: (tools) => serveTools(tools),
        fallback: noAgent(),
        ledger,
      })
    : undefined;
  // Assigning items to an agent (#293): the queue on the cache and the agent host, or the sample's, scripted.
  let assignments: AssignmentControl;
  const problems: string[] = [];
  if (cache && host) {
    const dataDir = settings.dataDir;
    // Toil UI's own view of execute(), which names the actor: a toil older than the option ignores it.
    const toilExecute: Execute = execute;
    const data = (dossier: string) => cacheData(cache!, dossier);
    const queue = new AssignmentQueue({
      keeper: fileKeeper(dataDir, problems),
      runner: hostRunner({ host, dataDir, registry: registry.commands, execute, mapIds, data, version: __TOIL_UI_VERSION__, toilVersion }),
      items: (dossier) => data(dossier)?.items() ?? null,
      people: async (dossier) => {
        const e = await execute('dossiers show', { dossier }, { readOnly: true, caller: CALLER });
        return e.ok ? readPeople((e.data as { dossier?: unknown } | null)?.dossier).people : [];
      },
      repos: (dossier) => reposOf(execute, dossier),
      // The one write an assignment makes, and only on a person's Apply: toil's own command, through its own gate, labelled with the assignment.
      apply: (a, p) => toilExecute(p.command!, { ...p.input, allowWrite: true }, { caller: CALLER, actor: actorOf(a.id) }),
      settings: () => queueSettings(dataDir),
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
    });
    assignments = {
      queue,
      saveSettings: (input) => {
        const checked = checkAssignSettings(input);
        saveAssignSettings(dataDir, checked);
        return checked;
      },
    };
  } else {
    const sample = sampleQueue();
    await sample.ready;
    assignments = { queue: sample.queue };
  }

  // A dossier renamed from its card or dashboard (#342): Toil UI's own records of it follow toil's rename.
  const renames: DossierRenames | undefined =
    cache && sync && worklog
      ? {
          blocked: (dossier) =>
            sync!.running
              ? { message: `A sync is running, so ${dossier} can't be renamed until it ends.`, fix: 'Wait for the Sync panel to say the sync finished, then rename it.' }
              : assignments.queue.runningIn(dossier)
                ? { message: `An assignment of ${dossier} is running, so it can't be renamed until it ends.`, fix: 'Wait for it to finish, or stop it from its page, then rename the dossier.' }
                : null,
          moved: async (from, to) => {
            const problems: string[] = [];
            const step = (what: string, fn: () => unknown) => {
              try {
                fn();
              } catch (e) {
                problems.push(`Toil UI couldn't move ${what} from ${from} to ${to}: ${e instanceof Error ? e.message : String(e)}`);
              }
            };
            step('its cache', () => cache!.rename(from, to));
            step('its assignments', () => assignments.queue.renameDossier(from, to));
            // The pages are folded again under the new name, and the old name's folder, which no dossier holds now, goes.
            await worklog!.reconcileAll().catch((e: unknown) => problems.push(`Toil UI couldn't fold the worklog again under ${to}: ${e instanceof Error ? e.message : String(e)}`));
            return problems;
          },
        }
      : undefined;

  const ui = createUiServer({
    ...(renames ? { renames } : {}),
    settings,
    store: cache ? sqliteStore(() => cache, execute, toil) : fixtureStore(),
    agent: host ?? fixtureAgent(),
    ...(host ? { agentControl: host } : {}),
    ...(sync ? { sync } : {}),
    worklog: worklog ?? fixtureWorklog(),
    usage,
    assignments,
    appDir: fileURLToPath(new URL('../app/', import.meta.url)),
    version: __TOIL_UI_VERSION__,
    toil,
    // The settings pages' connection fields come from toil's registry, and the time limit from the env toil runs in.
    config: settings.sample ? { areas: FIXTURE_AREAS, settings: settingsFrom({}) } : { areas: areasFrom(registry), settings: settingsFrom(process.env) },
  });

  serveTools = ui.serveTools;
  let address;
  try {
    address = await ui.listen();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const fix = code === 'EADDRINUSE' ? 'Another program has that port: pass --port 0 to let the OS pick a free one.' : 'Check --host and --port; see toil-ui --help.';
    process.stderr.write(`toil-ui: couldn't listen on ${settings.host}:${settings.port}: ${(e as Error).message}\n  Fix: ${fix}\n`);
    cache?.close();
    return 1;
  }

  process.stdout.write(
    [
      `Toil UI ${__TOIL_UI_VERSION__} (alpha, local only), on toil ${toilVersion}`,
      settings.sample ? 'Serving sample data and the scripted agent; nothing connects to a tracker.' : 'Syncing through toil, read-only, with your own connections and dossiers. Only its Settings pages, and a dossier\'s name and description edited in place, change anything: toil\'s own connections and dossiers, when you ask. The worklog keeps its pages and your notes in its data folder, and writes anywhere else only when you export one. Feedback goes to Imagile only when you send it.',
      ...(cache ? [`The cache is ${cache.paths.db}, kept ${settings.retentionDays} days after each sync; toil-ui wipe deletes it.`] : []),
      '',
      'Open this URL in your browser. It carries this launch\'s token, so keep it to yourself:',
      `  ${address.launchUrl}`,
      '',
      'Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );
  // A themes folder from an earlier alpha is never read; say so once per start rather than say nothing.
  const leftover = themesNotice(settings.dataDir);
  if (leftover) process.stderr.write(`${leftover}\n`);
  for (const problem of problems) process.stderr.write(`toil-ui: ${problem}\n`);

  await new Promise<void>((resolveStop) => {
    const stop = () => resolveStop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await ui.close();
  cache?.close();
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    process.stderr.write(`toil-ui failed to start: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exitCode = 1;
  },
);
