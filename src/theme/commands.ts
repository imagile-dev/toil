import { z } from 'zod';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { readConfigForEdit, writeConfigFile, type ResolvedConfig } from '../core/config.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { ToilError } from '../core/errors.js';
import { DEFAULT_THEME, findTheme, TERMINAL_THEMES } from '../welcome/themes/index.js';

/**
 * `toil theme list | set` (#427): the one theme setting, `"theme"` in
 * ~/.toil/config.json, that the welcome menu and Toil UI both follow.
 * `TOIL_THEME` overrides it. A theme only changes how the menu and Toil UI
 * look and word themselves; no envelope, help text or error changes with it.
 * `set` writes only that key, keeping every other as it was, and is refused
 * under the API's readOnly like every other local write.
 * Decor decisions, settled by one person, with no working group.
 */

/** Where the theme in effect came from: TOIL_THEME, the config file, or nowhere (the default). */
export type ThemeSource = 'env' | 'file' | 'default';

export interface ThemeInEffect {
  name: string;
  source: ThemeSource;
  /** What was set when toil doesn't have it, so the default shows instead. */
  unknown?: { name: string; source: 'env' | 'file' };
}

/** The theme in effect for a loaded config: the one set, when toil has it, else the default, Crate. */
export function themeInEffect(config: Pick<ResolvedConfig, 'theme'>): ThemeInEffect {
  const set = config.theme;
  if (!set) return { name: DEFAULT_THEME, source: 'default' };
  const source = set.source === 'env' ? 'env' : 'file';
  if (findTheme(set.name)) return { name: set.name, source };
  return { name: DEFAULT_THEME, source: 'default', unknown: { name: set.name, source } };
}

/** The warning for a theme toil doesn't have, in the words both the command and the menu use. */
export function unknownThemeWarning(unknown: NonNullable<ThemeInEffect['unknown']>): { code: string; message: string } {
  const from = unknown.source === 'env' ? 'TOIL_THEME' : '"theme" in the config file';
  return {
    code: 'THEME_UNKNOWN',
    message: `${from} is "${unknown.name}", which this toil doesn't have, so ${defaultLabel()}, the default, shows instead. The themes are ${TERMINAL_THEMES.map((t) => t.name).join(', ')}.`,
  };
}

const defaultLabel = () => findTheme(DEFAULT_THEME)?.label ?? DEFAULT_THEME;

function access(ctx: CommandContext<unknown>): ConfigAccess {
  if (!ctx.manage) throw new Error('A theme command ran without ctx.manage; define it with defineConfigCommand.');
  return ctx.manage;
}

const slashes = (path: string) => path.replace(/\\/g, '/');

export function themeCommands(): AnyCommand[] {
  const list = defineConfigCommand({
    path: ['theme', 'list'],
    description: 'List the themes the welcome menu and Toil UI can show, and which one is in effect',
    toolDescription:
      "Lists toil's themes (name and label) and the one in effect, with where it came from: env (TOIL_THEME), file (\"theme\" in the config file) or default (Crate, when neither is set; each theme says whether it is the default). A theme changes only how the welcome menu and Toil UI look, never any tool's output.",
    input: z.object({}),
    writes: false,
    writesLocal: false,
    examples: [{}],
    run: async (_input, ctx) => {
      const effect = themeInEffect(access(ctx).config);
      if (effect.unknown) ctx.warn(unknownThemeWarning(effect.unknown));
      return {
        current: effect.name,
        source: effect.source,
        default: DEFAULT_THEME,
        themes: TERMINAL_THEMES.map((t) => ({ name: t.name, label: t.label, current: t.name === effect.name, default: t.name === DEFAULT_THEME })),
      };
    },
  });

  const set = defineConfigCommand({
    path: ['theme', 'set'],
    description: 'Set the theme the welcome menu and Toil UI show, as "theme" in your config file',
    toolDescription:
      'Sets "theme" in the user\'s toil config file: the theme the welcome menu and Toil UI show. Changes nothing else, and no tool\'s output. Only for a person who asked for that theme; TOIL_THEME, when set, still wins.',
    input: z.object({ name: z.string().describe('The theme: one of the names toil theme list shows') }),
    writes: false,
    writesLocal: true,
    args: [{ name: 'name', field: 'name', description: 'The theme, as toil theme list names it' }],
    examples: [{ name: 'realm' }],
    run: async (input, ctx) => {
      const { config, env } = access(ctx);
      const theme = findTheme(input.name);
      if (!theme) {
        throw new ToilError('INVALID_INPUT', `toil has no theme named "${input.name}".`, { fix: `Use one of: ${TERMINAL_THEMES.map((t) => t.name).join(', ')}.` });
      }
      const path = config.files.global;
      const file = readConfigForEdit(path);
      const previous = typeof file.theme === 'string' ? file.theme : null;
      if (previous !== theme.name) writeConfigFile(path, { ...file, theme: theme.name });
      const fromEnv = env.TOIL_THEME?.trim();
      if (fromEnv && fromEnv !== theme.name) {
        ctx.warn({ code: 'OVERRIDDEN_BY_ENV', message: `TOIL_THEME is "${fromEnv}" and wins over the file; unset it for "${theme.name}" to show.` });
      }
      return { theme: theme.name, label: theme.label, previous, changed: previous !== theme.name, configFile: slashes(path) };
    },
  });

  return [list, set];
}
