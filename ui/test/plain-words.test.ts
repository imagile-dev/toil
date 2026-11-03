/**
 * Plain words (src/plain-words.ts): where the switch starts, the three words
 * it swaps inside a sentence, and the lookup that keeps a command typed
 * exactly. Pure functions, so no page is needed to hold them to it.
 */

import { describe, expect, it } from 'vitest';
import { initialPlain, plainify, wordsFor } from '../src/plain-words.ts';

describe('where plain words start', () => {
  it('follows ?words= in the address first, then what the browser saved, then standard', () => {
    expect(initialPlain('?words=plain', 'standard')).toBe(true);
    expect(initialPlain('?words=standard', 'plain')).toBe(false);
    expect(initialPlain('?words=off', 'plain')).toBe(false);
    expect(initialPlain('?theme=crate', 'plain')).toBe(true);
    expect(initialPlain('', null)).toBe(false);
    expect(initialPlain('?words=nonsense', null)).toBe(false);
  });
});

describe('plainify', () => {
  it('swaps dossier, pull request and agent, keeping case and plurals', () => {
    expect(plainify('Each dossier is one body of work.')).toBe('Each team is one body of work.');
    expect(plainify('Dossiers and pull requests')).toBe('Teams and code reviews');
    expect(plainify('An agent, two agents')).toBe('An AI helper, two AI helpers');
    expect(plainify("the dossier's agents")).toBe("the team's AI helpers");
  });

  it('leaves a toil command exactly as typed', () => {
    expect(plainify('Made with toil dossiers init.')).toBe('Made with toil dossiers init.');
    expect(plainify('Run toil dossiers describe card-payments, then ask the dossier.')).toBe('Run toil dossiers describe card-payments, then ask the team.');
  });
});

describe('wordsFor', () => {
  const lexicon = { 'dossiers.lede': 'Each dossier is one consignment of work.' };

  it('reads as wording.ts does with plain words off', () => {
    expect(wordsFor(lexicon, true, false, 'dossiers.lede')).toBe('Each dossier is one consignment of work.');
    expect(wordsFor(undefined, false, false, 'ask.placeholder', { name: 'card-payments' })).toBe('Ask about card-payments');
  });

  it('uses its own text for a key it words, over the theme', () => {
    expect(wordsFor(lexicon, true, true, 'dossier.eyebrow')).toBe('Team');
    expect(wordsFor(lexicon, true, true, 'ask.placeholder', { name: 'card-payments' })).toBe('Ask a question about card-payments');
  });

  it('swaps the jargon in a key it leaves to the theme or the standard text', () => {
    expect(wordsFor(lexicon, true, true, 'empty.prs')).toBe('No code reviews for this team.');
    expect(wordsFor(undefined, false, true, 'empty.deployments')).toBe('This team names no environment to read deployments from.');
  });

  it('keeps every {name} and every toil command the standard text has, in its own text', () => {
    const own = wordsFor(undefined, false, true, 'empty.dossiers');
    expect(own).toContain('toil dossiers init');
    expect(wordsFor(undefined, false, true, 'loading.dossier', { name: 'settlement' })).toBe('Reading settlement…');
  });
});
