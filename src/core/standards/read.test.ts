import { describe, expect, it } from 'vitest';
import { ToilError } from '../errors.js';
import { BUILTIN_STANDARDS, BUILTIN_STANDARD_NAMES, builtinStandard } from './builtin.js';
import { readStandard, standardContent } from './read.js';

const rule = (extra: Record<string, unknown> = {}) => ({ id: 'scenarios', name: 'Given/When/Then', text: 'Write the criteria as scenarios.', ...extra });
const standard = (extra: Record<string, unknown> = {}) => ({ name: 'team', rules: [rule()], ...extra });

function refusal(raw: unknown): ToilError {
  try {
    readStandard(raw, 'team.json');
  } catch (err) {
    return err as ToilError;
  }
  throw new Error('expected a refusal');
}

describe('readStandard', () => {
  it('reads a standard of plain-text rules, with revision 1 filled in', () => {
    const { standard: s, warnings } = readStandard(standard(), 'team.json');
    expect(warnings).toEqual([]);
    expect(s).toEqual({ name: 'team', revision: 1, rules: [{ id: 'scenarios', name: 'Given/When/Then', text: 'Write the criteria as scenarios.' }] });
  });

  it('keeps a rule\'s line breaks, as LF, with trailing spaces and blank edges tidied', () => {
    const { standard: s } = readStandard(standard({ rules: [rule({ text: '\n  For stories only.  \r\nGiven, When, Then.\t\n\n' })] }), 'team.json');
    expect(s.rules[0]!.text).toBe('For stories only.\nGiven, When, Then.');
  });

  it('warns on an unknown key and keeps going', () => {
    const { warnings } = readStandard(standard({ colour: 'blue', rules: [rule({ shade: 1 })] }), 'team.json');
    expect(warnings.map((w) => w.code)).toEqual(['STANDARD_UNKNOWN_KEY', 'STANDARD_UNKNOWN_KEY']);
    expect(warnings[0]!.message).toContain('team.json (colour)');
  });

  it('refuses a file in the old shape (check, when, fail, missing) with a fix saying how to move it over', () => {
    const old = refusal(standard({ rules: [rule({ when: { type: ['STORY'] }, fail: 'thin', check: { kind: 'pattern', in: ['criteria'], match: ['^given'] } })] }));
    expect(old.code).toBe('CONFIG_INVALID');
    expect(old.message).toContain('rules[0].check');
    expect(old.message).toContain('plain-text instructions an AI agent judges');
    expect(old.fix).toContain('remove check, when, fail and missing');
    expect(refusal(standard({ rules: [rule({ missing: 'no criteria' })] })).message).toContain('rules[0].missing');
  });

  it('refuses a name too long or one with a line break, text too long, control characters, and credential shapes, and says where', () => {
    expect(refusal(standard({ rules: [rule({ name: 'one\ntwo' })] })).message).toContain('rules[0].name: "name" must be one line');
    expect(refusal(standard({ rules: [rule({ text: 'x'.repeat(2001) })] })).message).toContain('the most is 2000');
    expect(refusal(standard({ rules: [rule({ text: 'a\u0007b' })] })).message).toContain('line breaks and tabs are fine');
    expect(refusal(standard({ rules: [rule({ text: 'Use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to log in' })] })).message).toContain('shaped like a credential');
    expect(refusal(standard({ rules: [rule({ text: '   ' })] })).message).toContain('must not be empty');
  });

  it('refuses a bad name, no rules, too many, and a repeated or malformed rule id', () => {
    expect(refusal(standard({ name: 'Team Rules' })).message).toContain('name:');
    expect(refusal(standard({ rules: [] })).message).toContain('rules:');
    expect(refusal(standard({ rules: Array.from({ length: 51 }, (_, i) => rule({ id: `r${i}` })) })).message).toContain('the most is 50');
    expect(refusal(standard({ rules: [rule(), rule()] })).message).toContain('"scenarios" is used by two rules');
    expect(refusal(standard({ rules: [rule({ id: 'Not An Id' })] })).message).toContain('"id" must be lowercase');
    expect(refusal(standard({ revision: 0 })).message).toContain('"revision" must be a whole number');
  });

  it('round-trips through its own content', () => {
    const { standard: s } = readStandard(standard({ revision: 4, description: 'Team rules.', rules: [rule({ text: 'Line one.\nLine two.' })] }), 'team.json');
    expect(readStandard(JSON.parse(standardContent(s)), 'again').standard).toEqual(s);
  });
});

describe('the built-in standards', () => {
  it('are gherkin, user-story and bug-repro, and each reads through the reader unchanged', () => {
    expect(BUILTIN_STANDARD_NAMES).toEqual(['gherkin', 'user-story', 'bug-repro']);
    for (const s of BUILTIN_STANDARDS) expect(readStandard(JSON.parse(standardContent(s)), `the built-in ${s.name}`).standard).toEqual(s);
  });

  it('say in their own words which items each rule is for, since the agent decides whether one applies', () => {
    for (const s of BUILTIN_STANDARDS) for (const r of s.rules) expect(r.text).toMatch(/^This rule is for (stories|bugs)\./);
  });

  it('hands out copies', () => {
    builtinStandard('gherkin')!.rules.length = 0;
    expect(builtinStandard('gherkin')!.rules).toHaveLength(1);
    expect(builtinStandard('nope')).toBeUndefined();
  });
});
