/**
 * The three standards that ship inside toil, as starter prompts: Given/When/Then
 * acceptance criteria for stories, the "As a …, I want …, so that …" story
 * form, and a bug that says how to reproduce it. Each rule is plain-text
 * instructions an AI agent judges an item against, written to be picked as a
 * starting point and then edited: Toil UI's Settings offers them when a person
 * adds a rule, and `toil standards save` keeps the edited copy in their own
 * folder. They are data, read through the same reader as a team's own file (a
 * test holds them to it), and none applies until a toil project or a call
 * names it: toil never decides on a team's behalf what a good ticket looks
 * like. The template committee may now stand down.
 */
import type { Standard } from './types.js';

export const BUILTIN_STANDARDS: readonly Standard[] = [
  {
    name: 'gherkin',
    revision: 2,
    description: "A story's acceptance criteria are written as Given/When/Then scenarios.",
    rules: [
      {
        id: 'scenarios',
        name: 'Acceptance criteria as Given/When/Then',
        text: [
          'This rule is for stories. For any other kind of item (a bug, a task, an epic), it does not apply.',
          "The story's acceptance criteria are written as one or more scenarios. Each scenario has a Given line (the starting context), a When line (what someone does) and a Then line (the outcome anyone can check).",
          'The criteria may be in an acceptance criteria field or under an "Acceptance criteria" heading in the description. A checklist, or criteria in prose without Given, When and Then, does not meet the rule.',
        ].join('\n'),
      },
    ],
  },
  {
    name: 'user-story',
    revision: 2,
    description: 'A story says who wants it, what they want, and why.',
    rules: [
      {
        id: 'story-form',
        name: 'Written as a user story',
        text: [
          'This rule is for stories. For any other kind of item, it does not apply.',
          'The description opens with the story in the form "As a <who>, I want <what>, so that <why>": it names who wants the change, what they want, and the reason. All three parts are there and say something specific; a placeholder such as "As a user, I want this, so that it works" does not meet the rule.',
        ].join('\n'),
      },
    ],
  },
  {
    name: 'bug-repro',
    revision: 2,
    description: 'A bug says how to reproduce it, what should happen, and what happens instead.',
    rules: [
      {
        id: 'steps',
        name: 'Steps to reproduce',
        text: [
          'This rule is for bugs. For any other kind of item, it does not apply.',
          'The bug lists the steps that reproduce it, in order, specific enough that someone else could follow them. They may be under a "Steps to reproduce" heading or in a repro steps field.',
        ].join('\n'),
      },
      {
        id: 'expected',
        name: 'Expected result',
        text: ['This rule is for bugs. For any other kind of item, it does not apply.', 'The bug says what should happen when the steps are followed.'].join('\n'),
      },
      {
        id: 'actual',
        name: 'Actual result',
        text: ['This rule is for bugs. For any other kind of item, it does not apply.', 'The bug says what happens instead: the wrong result, the error message, or what the person saw.'].join('\n'),
      },
    ],
  },
];

/** The built-in standard called `name`, or undefined. A copy, so a caller can't change what the next call sees. */
export function builtinStandard(name: string): Standard | undefined {
  const found = BUILTIN_STANDARDS.find((s) => s.name === name);
  return found && structuredClone(found);
}

export const BUILTIN_STANDARD_NAMES: readonly string[] = BUILTIN_STANDARDS.map((s) => s.name);
