/**
 * The user's own themes, in `~/.toil-ui/themes/<name>/` (#206): CSS, JSON and
 * assets only, never script, and never skins, which are script. This reads
 * the folder and checks every theme against src/theme-rules.ts, the same
 * rules the built-in themes are held to, so a theme with anything it may not
 * hold is refused whole, with each reason, rather than loaded in part. The
 * picker and the server's route for these files come with the user theme
 * folder (#206, milestone 8); the gate comes first. Bounded: a folder past
 * the limits is refused and says which limit it hit.
 * Customs declarations are required for all imported stylesheets.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { cssProblems, fileProblems, manifestProblems } from '../src/theme-rules.ts';
import type { ThemeManifest } from '../src/theme-pack.ts';

export const LIMITS = { themes: 50, files: 200, bytes: 4 * 1024 * 1024 };
const BUILT_IN = new Set(['plain', 'crate', 'harvest', 'starship', 'realm']);

export type UserTheme = { name: string; ok: true; manifest: ThemeManifest; files: string[] } | { name: string; ok: false; problems: string[] };

function walk(dir: string, found: string[], limit: number): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (found.length > limit) return;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) found.push(`${path}\0link`);
    else if (entry.isDirectory()) walk(path, found, limit);
    else found.push(path);
  }
}

/** One theme folder, checked. */
export function readUserTheme(dir: string, name: string): UserTheme {
  const problems: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return { name, ok: false, problems: [`"${name}": a theme's folder name is lower-case letters, digits and dashes.`] };
  if (BUILT_IN.has(name)) return { name, ok: false, problems: [`"${name}" is a built-in theme's name; pick another for the folder.`] };
  const paths: string[] = [];
  walk(dir, paths, LIMITS.files);
  if (paths.length > LIMITS.files) return { name, ok: false, problems: [`holds more than ${LIMITS.files} files.`] };
  let bytes = 0;
  const files: string[] = [];
  for (const full of paths) {
    const rel = relative(dir, full.replace(/\0link$/, '')).split(sep).join('/');
    if (full.endsWith('\0link')) {
      problems.push(`${rel}: is a link; a theme holds its own files only.`);
      continue;
    }
    bytes += statSync(full).size;
    const ext = rel.slice(rel.lastIndexOf('.')).toLowerCase();
    const text = ext === '.css' || ext === '.svg' || ext === '.json' ? readFileSync(full, 'utf8') : null;
    problems.push(...fileProblems(rel, text));
    files.push(rel);
  }
  if (bytes > LIMITS.bytes) problems.push(`is ${bytes} bytes, over the ${LIMITS.bytes}-byte limit.`);

  let manifest: unknown = null;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
    problems.push(...manifestProblems(name, manifest, { user: true }));
  } catch (e) {
    problems.push(`theme.json: ${e instanceof SyntaxError ? `isn't valid JSON (${e.message})` : 'is missing'}.`);
  }
  try {
    problems.push(...cssProblems(name, readFileSync(join(dir, 'theme.css'), 'utf8'), { user: true }));
  } catch {
    problems.push('theme.css: is missing.');
  }
  return problems.length ? { name, ok: false, problems } : { name, ok: true, manifest: manifest as ThemeManifest, files };
}

/** Every theme in the user's theme folder, each checked; none at all when the folder doesn't exist. */
export function readUserThemes(themesDir: string): UserTheme[] {
  let names: string[];
  try {
    names = readdirSync(themesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
  const over = names.length > LIMITS.themes;
  const out = names.slice(0, LIMITS.themes).map((name) => readUserTheme(join(themesDir, name), name));
  if (over) out.push({ name: '(more)', ok: false, problems: [`the folder holds more than ${LIMITS.themes} themes; only the first ${LIMITS.themes} were read.`] });
  return out;
}

/** Where the user's themes live: `themes/` in Toil UI's own folder. */
export const userThemesDir = (dataDir: string) => join(dataDir, 'themes');
