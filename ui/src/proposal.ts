/**
 * A proposal: a change to a tracker that the UI or the agent suggests and a
 * person applies (#206, principle 2). Toil UI never writes. A proposal names
 * the toil command that would make the change and its exact input, and shows
 * the command line to run through toil's write gate (`writes: true` on the
 * connection, `--allow-write` on the call). test/registry.test.ts holds every
 * proposal the board and the scripted agent can make to the real registry: the
 * command exists, it writes, and its input validates. Where toil has no
 * command for the change, the proposal says so instead of inventing one.
 * A change request that fills itself in and still waits for a signature.
 */

export interface Proposal {
  /** Stable for one suggestion, so the same move isn't listed twice. */
  id: string;
  /** Where it came from: a move on the board, or the agent's answer. */
  from: 'board' | 'agent';
  /** The OWI id of the work item it changes. */
  item: string;
  /** One line: "Move PAY-102 to In progress". */
  title: string;
  /** Why, or what it rests on. May cite items as `[[<owi id>]]`. */
  reason: string;
  /** The toil command that applies it, or null when toil has none yet. */
  command: string | null;
  /** The command's MCP input, as `execute()` would take it. */
  input: Record<string, unknown> | null;
  /** Anything a person should check first, or why there is no command. */
  note: string | null;
}

const flag = (key: string) => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const quote = (v: string) => (/^[\w.:/@=-]+$/.test(v) ? v : `"${v.replace(/(["\\$`])/g, '\\$1')}"`);

/** The command line that applies a proposal, `--dossier` first and `--allow-write` last; null without a command. */
export function commandLine(p: Pick<Proposal, 'command' | 'input'>): string | null {
  if (!p.command || !p.input) return null;
  const entries = Object.entries(p.input).sort(([a], [b]) => (a === 'dossier' ? -1 : b === 'dossier' ? 1 : 0));
  const parts = entries.flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${flag(k)} ${quote(String(x))}`) : [`${flag(k)} ${quote(String(v))}`]));
  return `toil ${p.command} ${parts.join(' ')} --allow-write`;
}
