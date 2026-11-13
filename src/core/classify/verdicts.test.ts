import { describe, expect, it } from 'vitest';
import { ToilError } from '../errors.js';
import type { Scheme } from './types.js';
import { MAX_VERDICTS, readVerdicts } from './verdicts.js';

const scheme = {
  name: 'ktlo-feature',
  revision: 1,
  categories: [
    { id: 'ktlo', short: 'KTLO', name: 'Keep the lights on', label: 'ktlo', definition: '' },
    { id: 'feature', short: 'Feature', name: 'Feature', label: 'feature', definition: '' },
  ],
} as Scheme;
const ids = new Set(['c:A-1', 'c:A-2']);
const read = (text: string) => readVerdicts(text, 'verdicts.json', scheme, ids);
const refusal = (text: string): ToilError => {
  try {
    read(text);
  } catch (err) {
    return err as ToilError;
  }
  throw new Error('expected a refusal');
};

describe('readVerdicts', () => {
  const good = [{ id: 'c:A-1', category: 'ktlo', reason: 'A bug.' }, { id: 'c:A-2', category: 'unsure', reason: 'Unclear.' }];

  it('reads an array, an object holding one, and either inside a fence', () => {
    expect(read(JSON.stringify(good))).toEqual(good);
    expect(read(JSON.stringify({ verdicts: good }))).toEqual(good);
    expect(read(`\`\`\`json\n${JSON.stringify(good)}\n\`\`\``)).toEqual(good);
    expect(read(`  \`\`\`\n${JSON.stringify({ verdicts: good }, null, 2)}\n\`\`\`  \n`)).toEqual(good);
  });

  it('drops anything but id, category and reason', () => {
    expect(read(JSON.stringify([{ id: 'c:A-1', category: 'ktlo', reason: 'r', extra: 1 }]))).toEqual([{ id: 'c:A-1', category: 'ktlo', reason: 'r' }]);
  });

  it.each([
    ['not json', 'nope', "isn't JSON"],
    ['a bare object', '{"id":"c:A-1"}', 'expected an array'],
    ['an entry that is not an object', '[1]', 'entry 0: expected an object'],
    ['an unknown id', '[{"id":"c:Z-9","category":"ktlo","reason":"r"}]', '"c:Z-9" is not one of the items'],
    ['an unknown category', '[{"id":"c:A-1","category":"chore","reason":"r"}]', '"chore" is not a category'],
    ['a missing reason', '[{"id":"c:A-1","category":"ktlo"}]', '"reason" must be a string'],
    ['a missing id', '[{"category":"ktlo","reason":"r"}]', '"id" must be'],
    ['a non-string category', '[{"id":"c:A-1","category":3,"reason":"r"}]', '"category" must be a string'],
    ['a duplicate id', '[{"id":"c:A-1","category":"ktlo","reason":"r"},{"id":"c:A-1","category":"feature","reason":"r"}]', 'entry 1: "c:A-1" already has a verdict'],
  ])('refuses %s', (_name, text, said) => {
    const err = refusal(text);
    expect(err).toBeInstanceOf(ToilError);
    expect(err.code).toBe('INVALID_INPUT');
    expect(err.message).toContain('verdicts.json');
    expect(err.message).toContain(said);
    expect(err.fix).toContain('ktlo, feature, unsure');
  });

  it('refuses more than the cap', () => {
    const many = JSON.stringify(Array.from({ length: MAX_VERDICTS + 1 }, () => ({ id: 'c:A-1', category: 'ktlo', reason: 'r' })));
    expect(refusal(many).message).toContain('more than the 5000');
  });
});
