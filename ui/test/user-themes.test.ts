// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readUserTheme, readUserThemes, userThemesDir } from '../server/user-themes.ts';

/**
 * A theme in the user's folder (`~/.toil-ui/themes/<name>/`, #206) is CSS,
 * JSON and assets only. Anything that could run script, ship a skin, or carry
 * the page's contents to another host through its stylesheet gets the whole
 * theme refused, with the reason.
 */

const plain = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'themes', 'plain', 'theme.json'), 'utf8')) as Record<string, unknown>;

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'toil-ui-themes-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const themes = () => userThemesDir(home);
function theme(name: string, files: Record<string, string>, manifest: Record<string, unknown> = {}) {
  const dir = join(themes(), name);
  const all = { 'theme.json': JSON.stringify({ ...plain, name, label: 'Mine', ...manifest }), 'theme.css': `[data-theme="${name}"] body { background: url("./assets/bg.svg"); }`, 'assets/bg.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>', ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}
const problems = (name: string) => {
  const t = readUserTheme(join(themes(), name), name);
  return t.ok ? [] : t.problems;
};

describe("the user's theme folder", () => {
  it('lives in themes/ in Toil UI\'s own folder, and is empty when there is none', () => {
    expect(themes()).toBe(join(home, 'themes'));
    expect(readUserThemes(themes())).toEqual([]);
  });

  it('accepts a theme of CSS, JSON and its own assets', () => {
    theme('mine', { 'assets/font.woff2': 'x', 'assets/tile.webp': 'x' });
    const [t] = readUserThemes(themes());
    expect(t).toMatchObject({ name: 'mine', ok: true });
    expect(t!.ok && t!.files.sort()).toEqual(['assets/bg.svg', 'assets/font.woff2', 'assets/tile.webp', 'theme.css', 'theme.json']);
  });

  it.each([
    ['a script file', { 'skin.js': 'alert(1)' }, /skin\.js: a theme holds only CSS, JSON and assets/],
    ['a module', { 'assets/skin.tsx': 'export {}' }, /assets\/skin\.tsx: a theme holds only/],
    ['an HTML page', { 'assets/page.html': '<p>' }, /page\.html: a theme holds only/],
    ['an SVG with a script', { 'assets/bg.svg': '<svg><script>alert(1)</script></svg>' }, /assets\/bg\.svg: holds something that runs script/],
    ['an SVG with an event handler', { 'assets/bg.svg': '<svg onload="alert(1)"/>' }, /holds something that runs script/],
    ['an SVG with foreign HTML', { 'assets/bg.svg': '<svg><foreignObject><p/></foreignObject></svg>' }, /holds something that runs script/],
    ['CSS with a javascript: URL', { 'theme.css': '[data-theme="bad"] a { background: url("javascript:alert(1)"); }' }, /runs script|leaves the theme's folder/],
    ['CSS with expression()', { 'theme.css': '[data-theme="bad"] a { width: expression(alert(1)); }' }, /runs script/],
  ])('refuses %s', (_, files, reason) => {
    theme('bad', files);
    expect(problems('bad').join('\n')).toMatch(reason);
  });

  it('refuses a theme that ships skins, since a skin is script', () => {
    theme('bad', {}, { skins: { Card: './card.js' } });
    expect(problems('bad')).toContain('theme.json: only built-in themes ship skins, since a skin is script.');
  });

  it.each([
    ['a remote image', 'url("https://tracker.imagile.dev/x.png")'],
    ['a protocol-relative image', 'url(//tracker.imagile.dev/x.png)'],
    ['a path above its folder', "url('../other/x.png')"],
    ['an absolute path', 'url(/etc/x.png)'],
  ])("refuses CSS that loads %s, which could carry the page's contents away", (_, url) => {
    theme('bad', { 'theme.css': `[data-theme="bad"] input[value^="a"] { background: ${url}; }` });
    expect(problems('bad').join('\n')).toMatch(/leaves the theme's folder/);
  });

  it('refuses @import and unscoped rules', () => {
    theme('bad', { 'theme.css': '@import "https://fonts.imagile.dev/x.css";\nbody { color: red; }' });
    const p = problems('bad');
    expect(p).toContain('theme.css: a user theme may use only @media, @supports, @font-face, @keyframes, not @import.');
    expect(p).toContain('theme.css: "body" isn\'t scoped to [data-theme="bad"].');
  });

  it('refuses a manifest whose fonts or radius would break out of the stylesheet', () => {
    theme('bad', {}, { fonts: { body: "x; } body { background: url(https://tracker.imagile.dev/) } a {", display: 'serif', mono: 'monospace' }, radius: '6px; color: red' });
    const p = problems('bad');
    expect(p).toContain('theme.json: fonts.body must be a font list, like "\'Fira Code\', monospace".');
    expect(p).toContain('theme.json: "radius" must be a length, like "6px".');
  });

  it('refuses a manifest with a missing token, a stranger name, or a word no theme may rename', () => {
    const schemes = { light: { ...(plain.schemes as { light: Record<string, string> }).light, ink: 'red' } };
    theme('bad', {}, { name: 'other', schemes, terms: { password: 'Secret' } });
    const p = problems('bad');
    expect(p).toContain('theme.json: "name" must be the folder\'s name, "bad".');
    expect(p).toContain('theme.json: light.ink must be a colour like #1b1f24.');
    expect(p.join('\n')).toMatch(/"password" isn't a word a theme can rename/);
  });

  it("refuses a built-in theme's name, a folder name that isn't plain, and links out of the folder", () => {
    theme('crate', {});
    expect(problems('crate')).toEqual(['"crate" is a built-in theme\'s name; pick another for the folder.']);
    theme('Bad Name', {});
    expect(problems('Bad Name')[0]).toMatch(/lower-case letters, digits and dashes/);
    const dir = theme('linked', {});
    try {
      symlinkSync(join(home, 'elsewhere.css'), join(dir, 'assets', 'elsewhere.css'));
    } catch {
      return; // Creating a link needs a privilege Windows doesn't always grant; the rule is the same.
    }
    expect(problems('linked')).toContain('assets/elsewhere.css: is a link; a theme holds its own files only.');
  });

  it('refuses a theme with no stylesheet or no manifest', () => {
    const dir = theme('bare', {});
    rmSync(join(dir, 'theme.css'));
    rmSync(join(dir, 'theme.json'));
    expect(problems('bare')).toEqual(expect.arrayContaining(['theme.json: is missing.', 'theme.css: is missing.']));
  });
});

