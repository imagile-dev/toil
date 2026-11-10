/**
 * The two schemes that ship inside toil, so a toil project with no `classify`
 * key still has somewhere to start. They are data, read through the same
 * reader as a team's own file (a test holds them to it), and a person who
 * wants different words copies one with `toil classify scheme init`. Every
 * organisation's first taxonomy meeting is hereby pre-adjourned.
 */
import { DEFAULT_SCHEME, type Scheme } from './types.js';

const KTLO = {
  id: 'ktlo',
  short: 'KTLO',
  name: 'Keep the lights on',
  label: 'ktlo',
  definition: 'Security patches, bug fixes, dependency upgrades, compliance updates and incident response.',
};

export const BUILTIN_SCHEMES: readonly Scheme[] = [
  {
    name: 'ktlo-feature',
    revision: 1,
    categories: [
      KTLO,
      {
        id: 'feature',
        short: 'Feature',
        name: 'Feature',
        label: 'feature',
        definition: "Proactive development that creates new user-facing functionality or expands the product's capabilities.",
      },
    ],
    guidance: ['An upgrade that exists to unlock a new user-facing capability is Feature; one that keeps the product supported is KTLO.'],
    examples: [],
    rules: [],
    signals: true,
    labels: {},
  },
  {
    name: 'balance',
    revision: 1,
    categories: [
      { id: 'new', short: 'New', name: 'New capabilities', label: 'new', definition: "Work that adds a product, feature or capability that didn't exist before." },
      {
        id: 'improve',
        short: 'Improve',
        name: 'Improvements',
        label: 'improve',
        definition: 'Work that makes something people already use better: enhancements, performance and usability beyond a fix.',
      },
      KTLO,
      {
        id: 'productivity',
        short: 'Productivity',
        name: 'Productivity',
        label: 'productivity',
        definition: 'Work that makes the team itself faster or safer: tooling, automation, build and test infrastructure, and paying down technical debt.',
      },
    ],
    guidance: [
      'A bug fix is KTLO, even when the bug is in something new; a change that makes a working feature better is Improve.',
      'Tooling, build and test work for the team is Productivity; the same work for customers is New or Improve.',
      'An upgrade that exists to unlock a new capability is New; one that keeps the product supported is KTLO.',
    ],
    examples: [],
    rules: [],
    signals: true,
    labels: {},
  },
];

/** The built-in scheme called `name`, or undefined. A copy, so a caller can't change what the next call sees. */
export function builtinScheme(name: string): Scheme | undefined {
  const found = BUILTIN_SCHEMES.find((s) => s.name === name);
  return found && structuredClone(found);
}

export const BUILTIN_NAMES: readonly string[] = BUILTIN_SCHEMES.map((s) => s.name);

/** The scheme a toil project gets when it names none. */
export const defaultScheme = (): Scheme => builtinScheme(DEFAULT_SCHEME)!;
