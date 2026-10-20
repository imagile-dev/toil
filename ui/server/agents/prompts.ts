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
    id: 'review',
    label: "What's stuck in review, and why?",
    prompt: (d) => `What's stuck in review in the dossier "${d}", and why? Use pr_query for the open pull requests and pr_get for detail: for each that is stuck, say what it waits on (review, changes, checks or merge) and for how many working days, its flags (no first review in 2 working days, checks failing for over a day, a merge conflict, no linked work item, a work item done while it is open), who wrote it (person, agent or bot), and the work items it carries. Use pr_metrics for how this compares with usual pickup and review times, quoting each figure's sample size.`,
  },
  {
    id: 'people-load',
    label: "Who's overloaded or blocked?",
    prompt: (d) => `Who in the dossier "${d}" is overloaded or blocked? Use people_list: say who has more in progress than the dossier's limit (or, with no limit set, who carries the most open work, as a fact and not a judgement), whose items are blocked and by what, and which reviews have waited longest on whom. Then person_get for anyone you name. Cite every item and pull request by its id. Describe each person's plate; never rank or score people against each other.`,
  },
  {
    id: 'one-on-one',
    label: 'Prepare my 1:1 notes for <person>',
    prompt: (d) =>
      `Someone wants 1:1 notes for a person in the dossier "${d}" but didn't say who. Call people_list and reply with the people they can ask about, one per line, each written as the question to ask: Prepare my 1:1 notes for <name>. Nothing else.`,
  },
  {
    id: 'ready',
    label: 'Which items are ready for an agent?',
    prompt: (d) =>
      `Which items in the dossier "${d}" are ready for an agent? Use readiness_list: name each ready item, then for the items that are thin or blocked, say which checks they fail and what would make them ready (acceptance criteria to write, a description to fill in, a blocker to finish). Use readiness_get for detail on any you discuss. Cite every item by its id. The verdicts are the readiness gate's: report them as they are, without judging them again.`,
  },
  {
    id: 'release-notes',
    label: 'Release notes',
    prompt: (d) => `Draft release notes for the dossier "${d}" from the work that is done, grouped by type, saying for each item where it is deployed if the cache shows that.`,
  },
];

/** "Prepare my 1:1 notes for Pat": the 1:1 starter with its person filled in, typed or picked. */
const ONE_ON_ONE = /^\s*prepare\s+(?:my\s+)?1:1\s+notes\s+for\s+(.+?)\s*[.?!]?\s*$/i;

/** The 1:1 notes question for one person: facts about the work, each citing its id, and nothing about the person. */
export const oneOnOnePrompt = (dossier: string, person: string) =>
  `Prepare 1:1 notes for ${person} in the dossier "${dossier}". Use person_get for ${person} (people_list if the name doesn't match). Stick to facts about the work: what they have in progress and for how long, their open pull requests and what each waits on, reviews waiting on them, what blocks them, and what they finished or reviewed lately, then two or three questions to ask about blockers and support. Cite every item and pull request by its id. No opinion of the person, no score, and no comparison with anyone else.`;

/** The question for a starter id, or the typed text as it is; "Prepare my 1:1 notes for <person>" typed out gets the 1:1 instructions. */
export function promptFor(dossier: string, prompt: string): { label: string; text: string } {
  const starter = STARTERS.find((s) => s.id === prompt);
  if (starter) return { label: starter.label, text: starter.prompt(dossier) };
  const oneOnOne = ONE_ON_ONE.exec(prompt)?.[1];
  return oneOnOne && !oneOnOne.startsWith('<') ? { label: prompt, text: oneOnOnePrompt(dossier, oneOnOne) } : { label: prompt, text: prompt };
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
    `1. Use only your tools. owi_query, owi_get, owi_similar and owi_history read the work items Toil UI last synced for "${dossier}"; owi_similar finds likely duplicates, so run it before proposing a new item. pr_query, pr_get and pr_metrics read its pull requests. people_list and person_get read what is on each person's plate; they describe load, never performance, so never rank or score people. The other tools are toil's live read commands for the same dossier; use them only when the cache can't answer. Never rely on anything you remember about these items.`,
    '2. Cite every work item you mention by its OWI id in double square brackets, such as [[jira:PAY-101]], and every pull request by its change id, such as [[github:imagile/payments-web#52]], exactly as your tools returned it. Never mention an item or pull request your tools did not return: the server checks every id against your tool results and flags any it never saw.',
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
