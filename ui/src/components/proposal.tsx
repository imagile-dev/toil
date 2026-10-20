/**
 * A proposal as a card to review (#252, #253): what would change, why, and
 * the toil command that applies it through the write gate. The card can copy
 * the command or be dismissed. It has no button of its own that applies
 * anything (principle 2): the one place Toil UI applies a proposal is an
 * agent assignment's page (#293), which passes its Apply in `actions` and
 * asks the server to run the proposal it stored, through toil's own gate.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Radio, RadioGroup } from 'react-aria-components';
import { SHELL_LABEL, commandLine, defaultShell, readLine, type Proposal, type Shell } from '../proposal.ts';
import { Cited } from './items.tsx';

// Which shell the commands are shown for: the viewer's by default, one choice for every card, remembered when storage allows.
const KEY = 'toil-ui.shell';
const listeners = new Set<() => void>();
let current: Shell | null = null;
function shellNow(): Shell {
  if (current) return current;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'posix' || saved === 'powershell') return (current = saved);
  } catch {
    // Not remembered; the default stands.
  }
  return (current = defaultShell());
}
function setShell(shell: Shell) {
  current = shell;
  try {
    localStorage.setItem(KEY, shell);
  } catch {
    // Not remembered.
  }
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export const useShell = () => useSyncExternalStore(subscribe, shellNow, shellNow);

export function ProposalCard({ proposal, onDismiss, kind = 'Proposed change, not applied', actions, children }: { proposal: Proposal; onDismiss?: () => void; kind?: string; actions?: ReactNode; children?: ReactNode }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const shell = useShell();
  const { line, reason, mcp } = commandLine(proposal, shell);
  const hint = proposal.hint ? { text: proposal.hint.text, ...readLine(proposal.hint, shell) } : null;
  // The toggle stays even when this shell can't carry a value, so the card can switch to one that can.
  const showShells = Boolean(proposal.command || proposal.hint);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(line!);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };
  return (
    <article className="proposal" aria-label={`Proposal: ${proposal.title}`}>
      <p className="proposal-kind">{kind}</p>
      <h3>{proposal.title}</h3>
      <p>
        <Cited text={proposal.reason} />
      </p>
      {showShells && (
        <RadioGroup className="shells" orientation="horizontal" value={shell} onChange={(v) => setShell(v as Shell)} aria-label="Show the command for">
          {(['powershell', 'posix'] as const).map((s) => (
            <Radio key={s} value={s} className="shell-choice">
              {SHELL_LABEL[s]}
            </Radio>
          ))}
        </RadioGroup>
      )}
      {line ? (
        <>
          <p className="note">Apply it yourself through toil's write gate:</p>
          <pre className="command">
            <code>{line}</code>
          </pre>
        </>
      ) : (
        proposal.command && (
          <>
            <p className="failure">{reason}</p>
            {mcp && (
              <pre className="command" aria-label={`MCP call to ${mcp.tool}`}>
                <code>{JSON.stringify({ tool: mcp.tool, input: mcp.input }, null, 2)}</code>
              </pre>
            )}
          </>
        )
      )}
      {proposal.note && <p className="note">{proposal.note}</p>}
      {hint && (
        <>
          <p className="note">{hint.text}</p>
          {hint.line ? (
            <pre className="command">
              <code>{hint.line}</code>
            </pre>
          ) : (
            <p className="failure">{hint.reason}</p>
          )}
        </>
      )}
      {children}
      <div className="proposal-actions">
        {actions}
        {line && (
          <Button className="btn" onPress={copy}>
            Copy command
          </Button>
        )}
        {onDismiss && (
          <Button className="btn btn--quiet" onPress={onDismiss}>
            Dismiss
          </Button>
        )}
        <span className="note" role="status">
          {copied === 'yes' ? 'Copied.' : copied === 'no' ? "Couldn't copy: select the command instead." : ''}
        </span>
      </div>
    </article>
  );
}
