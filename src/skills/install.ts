import type { Warning } from '../core/envelope.js';
import { ToilError } from '../core/errors.js';
import { cloneBranch, installedPlugins, installPlugin, pluginsIn, skillSources, slashes, type MarketplaceRef, type PluginChoice, type Target } from './folders.js';

/**
 * Installing a marketplace's plugins into skills folders, shared by
 * `marketplace add` (every plugin) and `marketplace sync` (one, all, or the
 * ones already installed). The data keeps the shapes skills managers already
 * read: one target is flat, several nest under `targets`.
 */

export type PluginResults = Record<string, { installed: string[]; failed: string[] }>;

export interface TargetResult {
  agent: string;
  target: string;
  plugins: PluginResults;
  total: number;
  skipped?: true;
  installedOnly?: true;
  message?: string;
}

export interface InstallOptions {
  marketplace: MarketplaceRef;
  clone: string;
  /** `all`, or one plugin's name. */
  plugin: string;
  /** With `all`, only the plugins already installed in each target. */
  installedOnly: boolean;
  toilVersion: string;
  warn: (warning: Warning) => void;
}

/** The plugins a marketplace offers, refusing one it doesn't when a single plugin was named. */
export function choicesFor(clone: string, marketplace: string, plugin: string): PluginChoice[] {
  const choices = pluginsIn(clone);
  if (choices.length === 0) {
    throw new ToilError('INVALID_INPUT', `Marketplace ${marketplace} has no plugins: no .claude-plugin/marketplace.json listing any, and no plugins/ folder.`, {
      fix: 'Check the marketplace repository: each plugin is a folder under plugins/ with a skills/ folder inside.',
    });
  }
  if (plugin !== 'all' && !choices.some((c) => c.name === plugin)) {
    throw new ToilError('INVALID_INPUT', `Plugin "${plugin}" isn't in marketplace ${marketplace}. It has: ${choices.map((c) => c.name).join(', ')}.`, {
      fix: `Pass one of those, or "all". toil skills marketplace plugins ${marketplace} lists them with descriptions.`,
    });
  }
  return choices;
}

export function installInto(target: Target, choices: PluginChoice[], o: InstallOptions): TargetResult {
  const base = { agent: target.agent, target: slashes(target.dir) };
  const offered = new Set(choices.map((c) => c.name));
  let requested: string[];
  if (o.plugin !== 'all') requested = [o.plugin];
  else if (o.installedOnly) {
    requested = installedPlugins(target.dir, o.marketplace).filter((p) => offered.has(p));
    if (requested.length === 0) {
      return { ...base, plugins: {}, total: 0, skipped: true, installedOnly: true, message: 'No installed plugins found — nothing to sync.' };
    }
  } else requested = choices.map((c) => c.name);

  const branch = cloneBranch(o.clone);
  const plugins: PluginResults = {};
  let total = 0;
  for (const plugin of requested) {
    const sources = skillSources(o.clone, choices.find((c) => c.name === plugin) ?? { name: plugin, description: '' });
    if (sources === undefined || sources === 'remote') {
      plugins[plugin] = { installed: [], failed: [] };
      o.warn(
        sources === 'remote'
          ? { code: 'SKILLS_PLUGIN_REMOTE', message: `Plugin "${plugin}" in marketplace ${o.marketplace.name} lives in another repository, which toil doesn't fetch, so nothing was installed from it.` }
          : { code: 'SKILLS_PLUGIN_EMPTY', message: `Plugin "${plugin}" in marketplace ${o.marketplace.name} has no skills in the clone, so nothing was installed from it.` },
      );
      continue;
    }
    const copied = installPlugin(sources, target.dir, { marketplace: o.marketplace.name, plugin, installedFrom: o.marketplace.repoUrl, branch }, o.marketplace, o.toilVersion);
    plugins[plugin] = { installed: copied.installed, failed: copied.failed };
    total += copied.installed.length;
    if (copied.notReplaced.length > 0) {
      o.warn({
        code: 'SKILLS_NOT_REPLACED',
        message: `Left ${copied.notReplaced.join(', ')} in ${slashes(target.dir)} as found: toil didn't install that from plugin "${plugin}", so it isn't toil's to replace. Move it aside and sync again to install the plugin's copy.`,
      });
    }
  }
  return { ...base, plugins, total };
}

/**
 * The sync data: one target keeps the flat shape (`plugins`/`total`/`target`,
 * or `plugin`/`installed`/`failed` for one plugin); several nest under `targets`.
 */
export function syncResult(marketplace: string, updated: boolean, plugin: string, results: TargetResult[], installedOnly: boolean): Record<string, unknown> {
  const tail = { marketplaceUpdated: updated, ...(installedOnly ? { installedOnly: true } : {}) };
  if (results.length === 1) {
    const r = results[0]!;
    if (r.skipped) return { marketplace, updated: false, skipped: true, target: r.target, message: r.message, ...tail };
    if (plugin === 'all') return { marketplace, plugins: r.plugins, total: r.total, target: r.target, ...tail };
    const single = r.plugins[plugin] ?? { installed: [], failed: [] };
    return { marketplace, plugin, installed: single.installed, failed: single.failed, total: single.installed.length, target: r.target, ...tail };
  }
  return {
    marketplace,
    ...(plugin === 'all' ? {} : { plugin }),
    targets: results,
    total: results.reduce((sum, r) => sum + r.total, 0),
    ...tail,
  };
}
