/**
 * The themes' voices, server side (#283). The page names its theme and says
 * whether "Themed agent voice" is on; the voice itself comes from the server's
 * own copy of each built-in `theme.json`, bundled into the bin, so a page can
 * pick a voice but never write one into the prompt. A person's custom voice,
 * from Settings, replaces the theme's while the voice is on, and Plain has no
 * voice at all, so with Plain nothing is added.
 * The approved phrasebook, kept in the server room rather than handed out at reception.
 */

import crate from '../../themes/crate/theme.json' with { type: 'json' };
import harvest from '../../themes/harvest/theme.json' with { type: 'json' };
import overworld from '../../themes/overworld/theme.json' with { type: 'json' };
import plain from '../../themes/plain/theme.json' with { type: 'json' };
import realm from '../../themes/realm/theme.json' with { type: 'json' };
import starship from '../../themes/starship/theme.json' with { type: 'json' };
import type { AskStyle } from '../../src/agent.ts';
import type { PromptStyle } from './prompts.ts';
import type { AgentSettings } from './settings.ts';

interface Voiced {
  name: string;
  label: string;
  voice?: string;
}

/** Every built-in theme, by name, with its voice when it has one. */
export const THEME_VOICES: ReadonlyMap<string, Voiced> = new Map(([plain, crate, harvest, starship, realm, overworld] as Voiced[]).map((t) => [t.name, t]));

/** What the page sends about the answer's style: the theme on screen, and the voice switch (the page's AskStyle). */
export type StyleChoice = AskStyle;

/** Thrown for a theme the server doesn't have; the server answers it as a 400. */
export class StyleError extends Error {
  readonly fix = `Send one of the built-in themes: ${[...THEME_VOICES.keys()].join(', ')}.`;
}

/** The page's style fields, checked: a built-in theme's name and a boolean, or neither. */
export function styleFrom(body: Record<string, unknown>): StyleChoice | null {
  if (body.theme === undefined && body.voice === undefined) return null;
  if (typeof body.theme !== 'string') throw new StyleError('Name the theme on screen, with the voice switch.');
  if (!THEME_VOICES.has(body.theme)) throw new StyleError(`There is no built-in theme ${JSON.stringify(body.theme)}.`);
  if (typeof body.voice !== 'boolean') throw new StyleError('voice is true or false: whether "Themed agent voice" is on.');
  return { theme: body.theme, voice: body.voice };
}

/**
 * The prompt's style for one question: the custom voice or the theme's, only
 * while the voice is on and the theme has one, and the person's instructions
 * always. No choice at all (an older page) is the voice off.
 */
export function promptStyle(choice: StyleChoice | null, settings: Pick<AgentSettings, 'instructions' | 'voice'>): PromptStyle {
  const theme = choice ? THEME_VOICES.get(choice.theme) : undefined;
  const voiced = choice?.voice === true && theme?.voice !== undefined;
  return { voice: voiced ? (settings.voice ?? theme!.voice!) : null, instructions: settings.instructions };
}
