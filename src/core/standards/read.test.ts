import { describe, expect, it } from 'vitest';
import { ToilError } from '../errors.js';
import { BUILTIN_STANDARDS, BUILTIN_STANDARD_NAMES, builtinStandard } from './builtin.js';
import { patternProblem, readStandard, standardContent } from './read.js';

const rule = (extra: Record<string, unknown> = {}) => ({ id: 'scenarios', name: 'Given/When/Then', text: 'Write the criteria as scenarios.', check: { kind: 'pattern', in: ['criteria'], match: ['^given\\b'], flags: 'im' }, ...extra });
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
  it('reads a standard with defaults filled in: revision 1, fail thin, no when', () => {
    const { standard: s, warnings } = readStandard(standard(), 'team.json');
    expect(warnings).toEqual([]);
    expect(s).toEqual({ name: 'team', revision: 1, rules: [{ id: 'scenarios', name: 'Given/When/Then', text: 'Write the criteria as scenarios.', fail: 'thin', check: { kind: 'pattern', in: ['criteria'], match: ['^given\\b'], flags: 'im' } }] });
  });

  it('reads every kind, a field place and a judge with its default place', () => {
    const { standard: s } = readStandard(
      standard({
        rules: [
          rule({ id: 'a', check: { kind: 'section', in: ['field:Microsoft.VSTS.TCM.ReproSteps', 'description'], heading: ['Steps'] } }),
          rule({ id: 'b', check: { kind: 'field', in: ['field:risk'] }, fail: 'fail' }),
          rule({ id: 'c', check: { kind: 'words', in: ['title', 'description'], min: 20 } }),
          rule({ id: 'd', check: { kind: 'judge' }, when: { type: ['STORY'] } }),
        ],
      }),
      'team.json',
    );
    expect(s.rules.map((r) => r.check)).toEqual([
      { kind: 'section', in: ['field:Microsoft.VSTS.TCM.ReproSteps', 'description'], heading: ['Steps'], minWords: 1 },
      { kind: 'field', in: ['field:risk'] },
      { kind: 'words', in: ['title', 'description'], min: 20 },
      { kind: 'judge', in: ['description'] },
    ]);
    expect(s.rules[1]!.fail).toBe('fail');
    expect(s.rules[3]!.when).toEqual({ type: ['STORY'] });
  });

  it('warns on an unknown key and keeps going', () => {
    const { warnings } = readStandard(standard({ colour: 'blue', rules: [rule({ shade: 1, check: { kind: 'field', in: ['title'], extra: 1 } })] }), 'team.json');
    expect(warnings.map((w) => w.code)).toEqual(['STANDARD_UNKNOWN_KEY', 'STANDARD_UNKNOWN_KEY', 'STANDARD_UNKNOWN_KEY']);
    expect(warnings[0]!.message).toContain('team.json (colour)');
  });

  it('refuses an empty when, which would quietly mean every item', () => {
    expect(refusal(standard({ rules: [rule({ when: {} })] })).message).toContain('rules[0].when: "when" must name at least one of');
  });

  it('refuses text that is multi-line, too long, or shaped like a credential, and says where', () => {
    expect(refusal(standard({ rules: [rule({ text: 'one\ntwo' })] })).message).toContain('rules[0].text: "text" must be one line');
    expect(refusal(standard({ rules: [rule({ text: 'x'.repeat(501) })] })).message).toContain('the most is 500');
    expect(refusal(standard({ rules: [rule({ text: 'Use ghp_abcdefghijklmnopqrstuvwxyz0123456789 to log in' })] })).message).toContain('shaped like a credential');
  });

  it('refuses a bad name, no rules, a repeated rule id, a bad fail and an unknown kind or place', () => {
    expect(refusal(standard({ name: 'Team Rules' })).message).toContain('name:');
    expect(refusal(standard({ rules: [] })).message).toContain('rules:');
    expect(refusal(standard({ rules: [rule(), rule()] })).message).toContain('"scenarios" is used by two rules');
    expect(refusal(standard({ rules: [rule({ fail: 'block' })] })).message).toContain('"fail" must be "thin"');
    expect(refusal(standard({ rules: [rule({ check: { kind: 'ai', in: ['title'] } })] })).message).toContain('"kind" must be one of pattern, section, field, words, judge');
    expect(refusal(standard({ rules: [rule({ check: { kind: 'field', in: ['body'] } })] })).message).toContain('"body" isn\'t a place');
    expect(refusal(standard({ rules: [rule({ check: { kind: 'field', in: ['title', 'title'] } })] })).message).toContain('listed twice');
    expect(refusal(standard({ rules: [rule({ check: { kind: 'words', in: ['title'] } })] })).message).toContain('"min" must be a whole number');
  });

  it('refuses flags beyond i, m and s, and a pattern that does not compile, is too long, or too many', () => {
    expect(refusal(standard({ rules: [rule({ check: { kind: 'pattern', in: ['title'], match: ['x'], flags: 'g' } })] })).message).toContain('"flags" may hold only i');
    expect(refusal(standard({ rules: [rule({ check: { kind: 'pattern', in: ['title'], match: ['('] } })] })).message).toContain("doesn't compile");
    expect(refusal(standard({ rules: [rule({ check: { kind: 'pattern', in: ['title'], match: ['a'.repeat(201)] } })] })).message).toContain('the most is 200');
    expect(refusal(standard({ rules: [rule({ check: { kind: 'pattern', in: ['title'], match: Array.from({ length: 11 }, () => 'a') } })] })).message).toContain('1 to 10 regular expressions');
  });

  it('refuses a pathological pattern before it can run', () => {
    for (const bad of ['(a+)+$', '(a|aa)*b', '(\\w+\\s?){2,}x', '(?:x*)*', '((ab)*)+']) {
      expect(refusal(standard({ rules: [rule({ check: { kind: 'pattern', in: ['title'], match: [bad] } })] })).message, bad).toContain('exponential time');
    }
    expect(refusal(standard({ rules: [rule({ check: { kind: 'pattern', in: ['title'], match: ['(a)\\1'] } })] })).message).toContain('backreference');
  });

  it('round-trips through its own content', () => {
    const { standard: s } = readStandard(standard({ revision: 4, description: 'Our rules.' }), 'team.json');
    expect(readStandard(JSON.parse(standardContent(s)), 'again').standard).toEqual(s);
  });
});

describe('patternProblem', () => {
  it('lets through the shapes the presets and ordinary rules use', () => {
    for (const ok of ['^\\W*given\\b', '\\bas an? [^,\\n]{1,80},? i want\\b[^\\n]{1,300}\\bso that\\b', '(?:foo|bar)', '(ab)?', '(abc){1}', '[(+*]+', 'a{2,5}?', '(?<year>\\d{4})-\\d\\d']) expect(patternProblem(ok), ok).toBeUndefined();
  });
});

describe('the built-in standards', () => {
  it('are gherkin, user-story and bug-repro, and each reads through the reader unchanged', () => {
    expect(BUILTIN_STANDARD_NAMES).toEqual(['gherkin', 'user-story', 'bug-repro']);
    for (const s of BUILTIN_STANDARDS) expect(readStandard(JSON.parse(standardContent(s)), `the built-in ${s.name}`).standard).toEqual(s);
  });

  it('hands out copies', () => {
    builtinStandard('gherkin')!.rules.length = 0;
    expect(builtinStandard('gherkin')!.rules).toHaveLength(1);
    expect(builtinStandard('nope')).toBeUndefined();
  });
});
