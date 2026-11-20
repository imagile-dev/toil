/**
 * Ticket rules, called standards in files and commands: the shape a team's
 * rules for writing a work item take. A standard is one JSON file holding one
 * named, revisioned set of rules, and a rule is plain-text instructions a
 * person writes and edits freely ("State the acceptance criteria as
 * Given/When/Then scenarios"). toil keeps them and lists them; it never judges
 * one, since judging a sentence of plain English takes a reader, and toil runs
 * no AI agent. Toil UI hands the rules and an item to the person's own agent
 * (ui/server/standards.ts). Everything here is data: no secret, host,
 * connection or `writes` ever lives in a standard, so a checked-in one can't
 * make toil talk to anything. The rules describe a well-written ticket; nobody
 * has yet proposed a rule for a well-read one.
 */

/** A standard's name is its file name (`<name>.json`), so it is held to one safe form. */
export const STANDARD_NAME = /^[a-z][a-z0-9-]{0,62}$/;
/** A rule's id within its standard: what a verdict and `?rule=<standard>/<rule>` name. */
export const STANDARD_RULE_ID = /^[a-z][a-z0-9-]{0,40}$/;

/** One rule: an id, a few plain words a screen shows, and the instructions an AI agent judges an item against. */
export interface StandardRule {
  id: string;
  /** A few plain words a screen shows ("Acceptance criteria as Given/When/Then"). */
  name: string;
  /**
   * The rule itself, in plain text: what a well-written item does, and which
   * items it is for. Several lines are fine. It reaches an AI agent only as
   * data inside a fence, never as the agent's own instructions.
   */
  text: string;
}

export interface Standard {
  name: string;
  revision: number;
  /** One line about the standard; absent when the file gives none. */
  description?: string;
  rules: StandardRule[];
}

/** Where a standard was found: a file the call named, your folder, the repository, beside the toil project, built in. */
export type StandardSource = 'file' | 'user' | 'repo' | 'toil-project' | 'built-in';

/** A standard as resolved: where it came from, and its file when it has one. */
export interface FoundStandard {
  standard: Standard;
  source: StandardSource;
  /** Absolute, with forward slashes. Absent for a built-in. */
  file?: string;
}

/** A standard as `toil standards list` prints it. */
export interface StandardSummary {
  name: string;
  revision: number;
  source: StandardSource;
  file?: string;
  /** Null when the file gives none. */
  description: string | null;
  rules: StandardRule[];
}

/** What a toil project says about standards: the ones its work is held to, in order. */
export interface StandardsSettings {
  use: string[];
}
