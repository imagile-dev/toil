/**
 * `toil-ui`, the bin (dist/server/toil-ui.js once built). It reads the
 * settings, picks the Store and Agent (toil's own `execute()` and no agent,
 * or the sample pair with `--sample`), starts the server on loopback and
 * prints the one URL that opens it, once. It opens no browser: that would mean
 * spawning a program, and the URL is right there. Ctrl+C stops it. The whole
 * onboarding process, minus the onboarding.
 */

import { execute, contractVersion as toilContract, version as toilVersion } from '@imagile-dev/toil/api';
import { fileURLToPath } from 'node:url';
import { fixtureAgent, noAgent } from './agent.ts';
import { createUiServer } from './server.ts';
import { parseSettings, SettingsError, USAGE } from './settings.ts';
import { fixtureStore, toilStore } from './store.ts';

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
  const ui = createUiServer({
    settings,
    store: settings.sample ? fixtureStore() : toilStore(execute),
    agent: settings.sample ? fixtureAgent() : noAgent(),
    appDir: fileURLToPath(new URL('../app/', import.meta.url)),
    version: __TOIL_UI_VERSION__,
    toil: { version: toilVersion, contractVersion: toilContract },
  });

  let address;
  try {
    address = await ui.listen();
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const fix = code === 'EADDRINUSE' ? 'Another program has that port: pass --port 0 to let the OS pick a free one.' : 'Check --host and --port; see toil-ui --help.';
    process.stderr.write(`toil-ui: couldn't listen on ${settings.host}:${settings.port}: ${(e as Error).message}\n  Fix: ${fix}\n`);
    return 1;
  }

  process.stdout.write(
    [
      `Toil UI ${__TOIL_UI_VERSION__} (alpha, local only), on toil ${toilVersion}`,
      settings.sample ? 'Serving sample data and the scripted agent; nothing connects to a tracker.' : 'Reading through toil, read-only, with your own connections and dossiers.',
      '',
      'Open this URL in your browser. It carries this launch\'s token, so keep it to yourself:',
      `  ${address.launchUrl}`,
      '',
      'Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );

  await new Promise<void>((resolveStop) => {
    const stop = () => resolveStop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await ui.close();
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
