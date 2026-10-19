/**
 * A proposal as a card to review (#252, #253): what would change, why, and
 * the toil command that applies it through the write gate. The card can copy
 * the command or be dismissed. It has no button that applies anything,
 * because Toil UI never writes (principle 2).
 */

import { useState } from 'react';
import { Button } from 'react-aria-components';
import { commandLine, type Proposal } from '../proposal.ts';
import { Cited } from './items.tsx';

export function ProposalCard({ proposal, onDismiss }: { proposal: Proposal; onDismiss?: () => void }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const line = commandLine(proposal);
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
      {line ? (
        <>
          <p className="note">Apply it yourself through toil's write gate:</p>
          <pre className="command">
            <code>{line}</code>
          </pre>
        </>
      ) : null}
      {proposal.note && <p className="note">{proposal.note}</p>}
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
