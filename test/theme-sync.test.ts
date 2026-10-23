import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splashFrame } from '../src/welcome/splash.js';
import { PALETTE } from '../src/welcome/term.js';
import { SPLASH_CUES } from '../src/welcome/themes/moments.generated.js';
import { contrast, MIN_CONTRAST, ORNAMENTS, palette, splashLook, TERMINAL_THEMES, terminalMotif, type Background } from '../src/welcome/themes/index.js';
// @ts-expect-error The repository's scripts are plain JavaScript with no declarations.
import { splashCues } from '../scripts/gen-areas.mjs';

/**
 * Each Toil UI theme's terminal version (src/welcome/themes/) against the
 * theme itself (ui/themes/<name>/theme.json), the way test/brand-sync.test.ts
 * holds the brand: the same themes, labels and colours, the words the menu
 * borrows from the theme's terms, its particles as the splash's ornament,
 * and its #419 splash cues, which the build reads from theme.json itself. A
 * new Toil UI theme fails here until it has a terminal version.
 */

const root = join(import.meta.dirname, '..');
const themesDir = join(root, 'ui', 'themes');
const folders = readdirSync(themesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

interface ThemeJson {
  name: string;
  label: string;
  schemes: Partial<Record<Background, Record<string, string>>>;
  terms?: Record<string, string>;
  ambient?: { particles?: string };
  moments?: { splash?: { motif?: string; line?: string } };
}
const json = (name: string): ThemeJson => JSON.parse(readFileSync(join(themesDir, name, 'theme.json'), 'utf8')) as ThemeJson;

/** Toil UI's particles, by the ornament the terminal draws for them. None is Plain's orbit. */
const ORNAMENT_FOR: Record<string, (typeof ORNAMENTS)[number]> = { none: 'orbit', dust: 'orbit', leaves: 'crops', stars: 'warp', embers: 'embers', rain: 'rain', steam: 'steam', fairies: 'fairies' };

it('has a terminal version of every Toil UI theme, and of nothing else', () => {
  expect(TERMINAL_THEMES.map((t) => t.name).sort()).toEqual(folders);
});

describe.each(TERMINAL_THEMES.map((t) => [t.name, t] as const))('%s', (name, theme) => {
  const ui = json(name);

  it("has the theme's name and label", () => {
    expect(theme.name).toBe(ui.name);
    expect(theme.label).toBe(ui.label);
  });

  it("copies every scheme's colours exactly", () => {
    expect(Object.keys(theme.schemes).sort()).toEqual(Object.keys(ui.schemes).sort());
    for (const [scheme, colours] of Object.entries(theme.schemes)) {
      for (const key of ['bg', 'ink', 'muted', 'accent', 'link', 'ok', 'danger'] as const) {
        expect(colours[key].toLowerCase(), `${scheme}.${key}`).toBe(ui.schemes[scheme as Background]![key]!.toLowerCase());
      }
    }
  });

  it("copies the terms its words use, and its words use them", () => {
    for (const [key, word] of Object.entries(theme.terms)) expect(word, key).toBe(ui.terms?.[key]);
    for (const key of ['agent', 'blocked'] as const) {
      if (ui.terms?.[key]) expect(theme.terms[key], `terms.${key} is copied`).toBe(ui.terms[key]);
    }
    if (theme.terms.blocked) expect(theme.words.attention.toLowerCase()).toContain(theme.terms.blocked.toLowerCase());
    if (theme.terms.agent) expect(theme.words.agent.toLowerCase()).toContain(theme.terms.agent.toLowerCase());
  });

  it("draws the ornament for the theme's particles", () => {
    expect(theme.ornament).toBe(ORNAMENT_FOR[ui.ambient?.particles ?? 'none']);
  });

  it.each(['dark', 'light'] as const)('reads on a %s terminal: every colour meets the bar on its background', (bg) => {
    const p = palette(theme, bg);
    for (const [role, colour] of Object.entries(p)) {
      if (role !== 'bg') expect(contrast(colour, p.bg), `${role} on ${bg}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("plays its splash with the theme's own cues, its line in full", () => {
    const look = splashLook(theme);
    const cue = ui.moments?.splash;
    if (cue?.motif) expect(look.motif).toBe(terminalMotif(cue.motif));
    expect(look.line).toBe(cue?.line);
    // 80 columns is the narrowest window that keeps the text beside the logo.
    for (const columns of [80, 120]) {
      const frame = splashFrame(99, { colorDepth: 1, unicode: true, columns }, '0.0.0', look);
      for (const line of frame) expect([...line].length, `${columns} columns`).toBeLessThanOrEqual(columns);
      const text = frame
        .join(' ')
        // The drawing beside the text: braille and block elements.
        .replace(/[▀-▟⠀-⣿]/g, '')
        .replace(/\s+/g, ' ');
      if (cue?.line) expect(text, `${columns} columns`).toContain(cue.line);
    }
  });
});

it("reads the splash cues from the themes' own files", () => {
  expect(SPLASH_CUES).toEqual(splashCues());
});

it("has a terminal rendition of every #419 enter motif a theme may name", () => {
  const schema = readFileSync(join(root, 'ui', 'src', 'moments', 'schema.ts'), 'utf8');
  const motifs = /ENTER_MOTIFS = \[([^\]]+)\]/.exec(schema)![1]!.match(/'([a-z-]+)'/g)!.map((m) => m.slice(1, -1));
  expect(motifs.length).toBeGreaterThan(3);
  for (const motif of motifs) expect(terminalMotif(motif), motif).toBeDefined();
});

it("keeps Plain's dark palette as toil's own, the site's tokens", () => {
  expect(palette(TERMINAL_THEMES[0]!, 'dark')).toEqual(PALETTE);
});
