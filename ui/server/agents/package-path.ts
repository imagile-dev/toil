/**
 * Finding an installed package on disk (#344), for an SDK that Install put in
 * place while Toil UI was running. Node remembers a bare specifier it failed
 * to resolve for the life of the process, so `import('@openai/codex-sdk')`
 * keeps failing after npm has installed it, until a restart. This walks up
 * from Toil UI's own folder the way Node would, finds the package's
 * package.json, and names its entry for `import`, which Toil UI then imports
 * by file URL, a specifier Node has never seen. Only for the agent SDKs, and
 * only after the ordinary import has failed. The filing cabinet, consulted
 * when the index card insists the folder was never there.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const read = (p: string) => {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

type Exports = string | null | { [condition: string]: Exports } | Exports[];

/** The file a package's `.` export names for `import` (or `default`), else its `main`. */
function entryOf(pkg: { exports?: Exports; main?: string }): string | null {
  const pick = (e: Exports | undefined): string | null => {
    if (typeof e === 'string') return e;
    if (!e || Array.isArray(e)) return null;
    if ('.' in e) return pick(e['.']);
    for (const condition of ['import', 'node', 'default']) if (condition in e) return pick(e[condition]);
    return null;
  };
  return pick(pkg.exports) ?? pkg.main ?? (pkg.exports === undefined ? 'index.js' : null);
}

/**
 * Where a package is installed, looking in each `node_modules` from `from`
 * up to the root: its folder, version and import entry, or null.
 */
export function findPackage(specifier: string, from: string = dirname(fileURLToPath(import.meta.url)), readText: (p: string) => string | null = read): { dir: string; version: string | null; entry: string | null } | null {
  for (let dir = from; ; dir = dirname(dir)) {
    const folder = join(dir, 'node_modules', ...specifier.split('/'));
    const text = readText(join(folder, 'package.json'));
    if (text) {
      try {
        const pkg = JSON.parse(text) as { name?: string; version?: string; exports?: Exports; main?: string };
        if (pkg.name === specifier) {
          const entry = entryOf(pkg);
          return { dir: folder, version: typeof pkg.version === 'string' ? pkg.version : null, entry: entry ? join(folder, entry) : null };
        }
      } catch {
        // Not a package.json Node could use either; keep climbing.
      }
    }
    if (dirname(dir) === dir) return null;
  }
}

/** The package's import entry as a file URL, for `import()`, or null when it isn't on disk. */
export function packageUrl(specifier: string, from?: string): string | null {
  const found = findPackage(specifier, from);
  return found?.entry ? pathToFileURL(found.entry).href : null;
}
