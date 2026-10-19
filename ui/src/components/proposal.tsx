/**
 * A proposal as a card to review (#252, #253): what would change, why, and
 * the toil command that applies it through the write gate. The card can copy
 * the command or be dismissed. It has no button that applies anything,
 * because Toil UI never writes (principle 2).
 */

import { useState, useSyncExternalStore } from 'react';
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

export function ProposalCard({ proposal, onDismiss }: { proposal: Proposal; onDismiss?: () => void }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const shell = useShell();
  const { line, reason } = commandLine(proposal, shell);
  const hint = proposal.hint ? { text: proposal.hint.text, ...readLine(proposal.hint, shell) } : null;
  const showShells = Boolean(line || hint?.line);
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
      <p className="proposal-kind">Proposed change, not applied</p>
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
        proposal.command && <p className="failure">{reason}</p>
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
      <div className="proposal-actions">
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
