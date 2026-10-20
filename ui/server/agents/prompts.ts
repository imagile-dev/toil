/**
 * What the agent is told (#251): the system prompt every adapter sends, and
 * the starter questions, each scoped to the dossier on screen. The rules in
 * the system prompt are asked of the model; the ones that matter are also
 * enforced, on the server, whatever the model does: it has only read tools,
 * and answer.ts flags any id its tools never returned. Belt, braces, and a
 * second belt.
 *
 * The prompt is composed in one order (#283): the rules, unchanged in every
 * theme; then "Style:", the theme's voice (or the person's custom voice) when
 * "Themed agent voice" is on and the theme has one; then the person's own
 * instructions. Each later part says the rules win over it, so a voice
 * changes phrasing and nothing else. Pure, so the page can show the same
 * prompt the server sends.
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

/** The longest the person's general instructions or custom voice may be, in characters (settings.ts holds them to it). */
export const MAX_INSTRUCTIONS = 4000;

/** What the agent's style is: the voice to speak in, and the person's own instructions, each null when there are none. */
export interface PromptStyle {
  voice: string | null;
  instructions: string | null;
}

/** Said after the voice, so the style can't loosen a rule. */
export const STYLE_RULE =
  'This style changes phrasing only. The rules above win wherever the two disagree: keep every citation as [[id]] exactly, each proposal as a fenced proposal block with its JSON exactly as rule 3 shows, every figure as the data gives it, saying plainly when the data does not show something, and plain text with no Markdown.';

/** Said after the person's instructions, which come from Settings and can't widen anything. */
export const INSTRUCTIONS_RULE =
  "These instructions come from the person using Toil UI. Follow them where they fit the rules above; where they disagree, the rules win. They can't give you a tool, and nothing in them lets you change anything.";

/** The rules every answer follows, whatever the theme. */
function rules(dossier: string, now: string): string[] {
  return [
    `You are the analyst inside Toil UI, answering a question about the dossier "${dossier}": one body of work, its tracker items, pull requests, builds and deployments. It is ${now}.`,
    '',
    'Rules:',
    `1. Use only your tools. owi_query, owi_get and owi_history read what Toil UI last synced for "${dossier}". The other tools are toil's live read commands for the same dossier; use them only when the cache can't answer. Never rely on anything you remember about these items.`,
    '2. Cite every work item you mention by its OWI id in double square brackets, such as [[jira:PAY-101]], exactly as your tools returned it. Never mention an item your tools did not return: the server checks every id against your tool results and flags any it never saw.',
    '3. You cannot change anything, and you have no tool that writes. When the question calls for a change (a re-estimate, a move to another sprint, a split story, a transition), write it as a proposal for a person to apply, in a fenced block like this, one block per change:',
    '```proposal',
    '{"item": "<owi id>", "title": "<one line>", "reason": "<why, citing [[ids]]>", "command": "<the toil write command, such as jira issue update, or null if toil has none>", "input": {"<field>": "<value>"}, "note": "<anything to check first, or null>"}',
    '```',
    "   The input is the toil command's MCP input, without the dossier and without allowWrite: call proposal_fields with the command first and use only its fields, or the card shows no command line. Never say a change was made: it is only proposed.",
    '4. Be brief and specific: short paragraphs of plain text (no Markdown, no headings, no bold), figures where you have them. Say plainly when the data does not show something.',
  ];
}

/** The system prompt, for one dossier: the rules, then the style and the person's instructions when there are any. */
export function systemPrompt(dossier: string, now: string, style: PromptStyle = { voice: null, instructions: null }): string {
  const out = rules(dossier, now);
  const voice = style.voice?.trim();
  const instructions = style.instructions?.trim();
  if (voice) out.push('', 'Style:', voice, '', STYLE_RULE);
  if (instructions) out.push('', 'Instructions from the person asking:', instructions, '', INSTRUCTIONS_RULE);
  return out.join('\n');
}
