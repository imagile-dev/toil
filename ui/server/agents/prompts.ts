/**
 * What the agent is told (#251): the system prompt every adapter sends, and
 * the starter questions, each scoped to the dossier on screen. The rules in
 * the system prompt are asked of the model; the ones that matter are also
 * enforced, on the server, whatever the model does: it has only read tools,
 * and answer.ts flags any id its tools never returned. Belt, braces, and a
 * second belt.
 */

import type { Starter } from '../../src/agent.ts';

export interface StarterPrompt extends Starter {
  /** The question as the model gets it, written for the dossier. */
  prompt(dossier: string): string;
}

export const STARTERS: readonly StarterPrompt[] = [
  {
    id: 'standup',
    label: 'Stand-up digest',
    prompt: (d) => `Write a stand-up digest for the dossier "${d}": what moved since yesterday, what is in progress and with whom, and what is blocked. Use the transitions to say what moved.`,
  },
  {
    id: 'sprint-risk',
    label: 'Why is this sprint at risk?',
    prompt: (d) => `Why is the current sprint in the dossier "${d}" at risk? Weigh points left against days left, blocked and blocking items, failing builds, scope added after the sprint started, and work carried over.`,
  },
  {
    id: 'hygiene',
    label: 'Backlog hygiene',
    prompt: (d) => `Review the backlog hygiene of the dossier "${d}": stale items (no update for over 5 days), unestimated items, items with no parent or epic, and items with no assignee. Propose fixes as proposals where toil has a command for them.`,
  },
  {
    id: 'dependencies',
    label: 'Dependency risk',
    prompt: (d) => `What is the dependency risk in the dossier "${d}"? Follow the blocks links, say which chains are longest, which blockers are not moving, and what unblocks the most work.`,
  },
  {
    id: 'release-notes',
    label: 'Release notes',
    prompt: (d) => `Draft release notes for the dossier "${d}" from the work that is done, grouped by type, saying for each item where it is deployed if the cache shows that.`,
  },
];

/** The question for a starter id, or the typed text as it is. */
export function promptFor(dossier: string, prompt: string): { label: string; text: string } {
  const starter = STARTERS.find((s) => s.id === prompt);
  return starter ? { label: starter.label, text: starter.prompt(dossier) } : { label: prompt, text: prompt };
}

/** The system prompt, for one dossier. */
export function systemPrompt(dossier: string, now: string): string {
  return [
    `You are the analyst inside Toil UI, answering a question about the dossier "${dossier}": one body of work, its tracker items, pull requests, builds and deployments. It is ${now}.`,
    '',
    'Rules:',
    `1. Use only your tools. owi_query, owi_get and owi_history read what Toil UI last synced for "${dossier}". The other tools are toil's live read commands for the same dossier; use them only when the cache can't answer. Never rely on anything you remember about these items.`,
    '2. Cite every work item you mention by its OWI id in double square brackets, such as [[jira:PAY-101]], exactly as your tools returned it. Never mention an item your tools did not return: the server checks every id against your tool results and flags any it never saw.',
    '3. You cannot change anything, and you have no tool that writes. When the question calls for a change (a re-estimate, a move to another sprint, a split story, a transition), write it as a proposal for a person to apply, in a fenced block like this, one block per change:',
    '```proposal',
    '{"item": "<owi id>", "title": "<one line>", "reason": "<why, citing [[ids]]>", "command": "<the toil write command, such as jira update-issue, or null if toil has none>", "input": {"<field>": "<value>"}, "note": "<anything to check first, or null>"}',
    '```',
    "   The input is the toil command's MCP input, without the dossier and without allowWrite: call proposal_fields with the command first and use only its fields, or the card shows no command line. Never say a change was made: it is only proposed.",
    '4. Be brief and specific: short paragraphs of plain text (no Markdown, no headings, no bold), figures where you have them. Say plainly when the data does not show something.',
  ].join('\n');
}
