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

/**
 * The shells a proposal's command line is written for. Every value is single
 * quoted, the one quoting both shells expand nothing inside: no `$(...)`, no
 * backticks, no variables, no backslash escapes. Double quotes are never used.
 */
export type Shell = 'posix' | 'powershell';
export const SHELL_LABEL: Record<Shell, string> = { posix: 'bash/zsh', powershell: 'PowerShell' };

/** Characters PowerShell reads as a single quote: the ASCII one and the typographic ones. */
const PS_QUOTES = /['\u2018\u2019\u201A\u201B]/g;

/**
 * One argument, single quoted for the shell. POSIX writes a `'` inside as
 * `'\''` (close, escaped quote, reopen); PowerShell doubles every character it
 * treats as a single quote. A line break can't be written on one command line
 * a person pastes, so a value holding one is refused (null) rather than split.
 */
export function quote(value: string, shell: Shell): string | null {
  if (/[\r\n\u0085\u2028\u2029]/.test(value) || value.includes('\0')) return null;
  return shell === 'posix' ? `'${value.replace(/'/g, `'\\''`)}'` : `'${value.replace(PS_QUOTES, (q) => q + q)}'`;
}

export type CommandLine = { line: string; reason: null } | { line: null; reason: string };

/**
 * The command line that applies a proposal, for one shell: `--dossier` first,
 * `--allow-write` last, every value single quoted. A value starting with `-`
 * is attached to its flag (`'--key=-x'`), so it can never read as a flag of
 * its own. Null, with the reason, when there is no command or a value can't be
 * written safely on one line.
 */
export function commandLine(p: Pick<Proposal, 'command' | 'input'>, shell: Shell): CommandLine {
  if (!p.command || !p.input) return { line: null, reason: 'toil has no command for this change.' };
  const entries = Object.entries(p.input).sort(([a], [b]) => (a === 'dossier' ? -1 : b === 'dossier' ? 1 : 0));
  const parts: string[] = [];
  for (const [k, v] of entries) {
    for (const x of Array.isArray(v) ? v : [v]) {
      const value = String(x);
      const quoted = value.startsWith('-') ? quote(`${flag(k)}=${value}`, shell) : quote(value, shell);
      if (quoted === null) return { line: null, reason: `The ${flag(k)} value holds a line break, which can't be pasted as one command. Run it from an --input-file instead.` };
      parts.push(value.startsWith('-') ? quoted : `${flag(k)} ${quoted}`);
    }
  }
  return { line: `toil ${p.command} ${parts.join(' ')} --allow-write`, reason: null };
}

/** The viewer's shell: PowerShell on Windows, POSIX anywhere else. */
export function defaultShell(nav: { platform?: string; userAgentData?: { platform?: string } } | undefined = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } })): Shell {
  const platform = nav?.userAgentData?.platform || nav?.platform || '';
  return /^win/i.test(platform) ? 'powershell' : 'posix';
}
