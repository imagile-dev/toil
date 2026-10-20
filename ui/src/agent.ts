/**
 * The agent seam (#206, Reasoning on the subscription you already have). An
 * agent answers questions about one dossier's work, as the dashboard read it
 * through toil, and cites every item it used; it never writes. A change it
 * suggests comes back as a proposal (src/proposal.ts) a person reviews and
 * applies through toil's write gate, so this interface has no way to send
 * one. An answer may stream (#253): `stream` yields the answer as it grows,
 * and the pane shows it as it arrives. A suggestion box that cannot be
 * emptied, by design.
 */

import type { AnswerUsage, ChatTurn } from './model-usage.ts';
import type { Proposal } from './proposal.ts';

/** One paragraph of an answer, and the work items it rests on. */
export interface AnswerPart {
  /** Text with each cited item written as `[[<owi id>]]`, which the UI renders as a link. */
  text: string;
}

export interface Answer {
  prompt: string;
  parts: AnswerPart[];
  /** Every OWI id the answer cites, in order of first mention. */
  citations: string[];
  /** Who answered: the adapter and model, or `scripted` for the preview. */
  by: string;
  /** Changes it suggests, for a person to review and apply. Never applied by the UI. */
  proposals: Proposal[];
  /**
   * Ids the answer names that none of its tool calls returned (#251): the
   * server's citation check. The pane flags each one as unverified.
   */
  unverified?: string[];
  /** What the server's checks found, in words the pane shows above the answer. */
  warnings?: string[];
  /** What the SDK reported this question used (#295), on the finished answer only. */
  usage?: AnswerUsage;
}

export interface Starter {
  id: string;
  label: string;
}

/** Who answers in the preview and with --sample: the scripted agent, named so nobody mistakes it for a model. */
export const SCRIPTED_LABEL = 'a scripted preview, not a model';

/** What the pane says when no adapter is chosen (#251), naming the three. */
export const NO_AGENT_NOTICE =
  'No agent is set up in this Toil UI, so nobody can answer yet. Toil UI reasons with the subscription you already have, through one of three adapters: Claude (the Claude Agent SDK, @anthropic-ai/claude-agent-sdk), GitHub Copilot (@github/copilot-sdk) or Codex (@openai/codex-sdk).';
export const NO_AGENT_FIX = 'Install the one your organization approves beside toil-ui, with its CLI on PATH, and choose it under Settings, Agent. The dashboards work without one, and toil-ui --sample shows the scripted agent.';

/**
 * How the answer should sound (#283): the theme on screen and whether
 * "Themed agent voice" is on. The server turns it into the prompt's style
 * from its own copy of the theme, so the page names a theme and never sends
 * prompt text.
 */
export interface AskStyle {
  theme: string;
  voice: boolean;
}

export interface Agent {
  /** A line the pane shows before any question, such as that no agent is set up. */
  notice?: string;
  /** Who answers, in words, for the pane's info: an adapter's name, or the scripted preview. */
  label?: string;
  /** The questions offered about a dossier before anyone types. */
  starters(dossier: string): Starter[];
  /** Answers about the named dossier only. */
  ask(dossier: string, prompt: string, style?: AskStyle, chat?: ChatTurn): Promise<Answer>;
  /**
   * The same answer as it grows: each value is the answer so far, and the
   * last is the whole of it. Optional; the pane falls back to `ask`.
   */
  stream?(dossier: string, prompt: string, signal?: AbortSignal, style?: AskStyle, chat?: ChatTurn): AsyncIterable<Answer>;
}

const CITE = /\[\[([^\]]+)\]\]/g;

/** The OWI ids an answer's text cites, in order of first mention. */
export function citationsOf(parts: AnswerPart[]): string[] {
  const seen = new Set<string>();
  for (const part of parts) for (const m of part.text.matchAll(CITE)) seen.add(m[1]!);
  return [...seen];
}

export type Segment = { text: string } | { cite: string };

/** Splits a part into plain text and citations, for rendering. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ cite: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
