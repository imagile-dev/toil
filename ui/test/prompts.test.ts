import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INSTRUCTIONS_RULE, STYLE_RULE, systemPrompt } from '../server/agents/prompts.ts';
import { promptStyle, styleFrom, StyleError, THEME_VOICES } from '../server/agents/voices.ts';
import { THEMES } from '../src/themes.ts';

/**
 * How the agent's system prompt is composed (#283): the rules, unchanged in
 * every theme; then "Style:" with the theme's voice, or the person's custom
 * voice, only while "Themed agent voice" is on and the theme has a voice;
 * then the person's instructions. Each later part says the rules win, so a
 * voice changes phrasing and never a citation, a proposal block, a figure or
 * the plain-text rule.
 * The style guide is subordinate to the policy manual, as style guides always are.
 */

const NOW = '2026-10-13T08:00:00.000Z';
const RULES = systemPrompt('card-payments', NOW);
const none = { instructions: null, voice: null };
const compose = (theme: string, voice: boolean, saved: { instructions: string | null; voice: string | null } = none) => systemPrompt('card-payments', NOW, promptStyle({ theme, voice }, saved));

describe('the system prompt', () => {
  it('starts with the same rules in every theme, voice on or off', () => {
    for (const t of THEMES) for (const voice of [true, false]) expect(compose(t.name, voice).startsWith(RULES)).toBe(true);
    // The rules keep what the server checks and the pane renders: citations, the proposal block, plain text.
    expect(RULES).toContain('[[jira:PAY-101]]');
    expect(RULES).toContain('```proposal');
    expect(RULES).toContain('plain text (no Markdown, no headings, no bold)');
    expect(RULES).toContain('Say plainly when the data does not show something.');
    expect(RULES).not.toContain('Style:');
  });

  it.each(THEMES.filter((t) => t.voice).map((t) => [t.name, t.voice!] as const))('adds %s\'s voice as style after the rules, saying the rules win, only while the voice is on', (name, voice) => {
    const on = compose(name, true);
    expect(on).toBe(`${RULES}\n\nStyle:\n${voice}\n\n${STYLE_RULE}`);
    expect(compose(name, false)).toBe(RULES);
  });

  it('adds nothing for Plain, which has no voice, even with the voice on and a custom voice saved', () => {
    expect(THEME_VOICES.get('plain')!.voice).toBeUndefined();
    expect(compose('plain', true)).toBe(RULES);
    expect(compose('plain', true, { instructions: null, voice: 'Talk like a pirate.' })).toBe(RULES);
  });

  it('puts a custom voice in place of the theme\'s, and the instructions last, in every theme', () => {
    const saved = { instructions: 'Answer in British English. Lead with risks.', voice: 'Talk like a quartermaster.' };
    expect(compose('crate', true, saved)).toBe(`${RULES}\n\nStyle:\nTalk like a quartermaster.\n\n${STYLE_RULE}\n\nInstructions from the person asking:\nAnswer in British English. Lead with risks.\n\n${INSTRUCTIONS_RULE}`);
    // With the voice off the custom voice goes too; the instructions stay, in every theme.
    for (const t of THEMES) expect(compose(t.name, false, saved)).toBe(`${RULES}\n\nInstructions from the person asking:\nAnswer in British English. Lead with risks.\n\n${INSTRUCTIONS_RULE}`);
  });

  it('says in plain words that style and instructions change phrasing only and widen nothing', () => {
    for (const kept of ['[[id]]', 'fenced proposal block with its JSON', 'every figure', 'saying plainly when the data does not show something', 'plain text with no Markdown']) expect(STYLE_RULE).toContain(kept);
    expect(STYLE_RULE).toMatch(/^This style changes phrasing only\. The rules above win/);
    expect(INSTRUCTIONS_RULE).toMatch(/the rules win\. They can't give you a tool/);
  });

  it('is the rules alone for a page that sends no style, as an older page does', () => {
    expect(systemPrompt('card-payments', NOW, promptStyle(null, { instructions: null, voice: 'x' }))).toBe(RULES);
  });
});

describe("the page's style fields", () => {
  it('take a built-in theme and a boolean, or neither, and nothing else', () => {
    expect(styleFrom({})).toBeNull();
    expect(styleFrom({ theme: 'realm', voice: false })).toEqual({ theme: 'realm', voice: false });
    expect(() => styleFrom({ theme: 'my-theme', voice: true })).toThrow(StyleError);
    expect(() => styleFrom({ theme: 'crate', voice: 'yes' })).toThrow(/true or false/);
    expect(() => styleFrom({ voice: true })).toThrow(/Name the theme on screen/);
  });

  it("read each voice from the server's own copy of the theme, never from the page", () => {
    for (const t of THEMES) expect(THEME_VOICES.get(t.name)?.voice).toBe(t.voice);
  });
});

describe('the themes documentation', () => {
  it('shows the composed prompt exactly as the server builds it, for Crate with one instruction', () => {
    const doc = readFileSync(join(import.meta.dirname, '..', 'docs', 'themes.md'), 'utf8');
    const shown = /````text\n([\s\S]*?)\n````/.exec(doc)?.[1];
    expect(shown).toBe(compose('crate', true, { instructions: 'Answer in British English. Lead with risks.', voice: null }));
  });
});
