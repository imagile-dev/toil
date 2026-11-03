/**
 * Stale sessions in the views (#305): the badge a chat, an assignment and an
 * agent's card show when what they started on has changed, and the header's
 * line when the server itself is older than what is on disk. Plain words in
 * every theme: a reason is a fact, and facts don't get a lexicon. A sticker
 * on the folder that says the folder has been superseded, in red, by order.
 */

import { useEffect, useState } from 'react';
import type { ServerStatus, Staleness } from '../fingerprint.ts';
import { usePlain } from '../plain-words.ts';

/** The word on the badge. */
export function StaleChip() {
  const plain = usePlain();
  return (
    <span className="stale-chip" title={plain.on ? 'Started before an update. In toil: stale' : undefined}>
      {plain.pw('Stale', 'Out of date')}
    </span>
  );
}

/** The badge and why, on one line: "Stale started on toil 0.1.0-alpha.3 · now alpha.4 · dossier changed". */
export function StaleNote({ stale, className = '' }: { stale: Staleness; className?: string }) {
  const plain = usePlain();
  // Plain words say it in one line and keep the exact reason one hover away; the reason is a fact, so standard keeps it on the line.
  return (
    <p className={`stale-note ${className}`.trim()} data-stale="">
      <StaleChip /> {plain.on ? <span title={`${stale.text}.`}>Started before an update.</span> : <span>{stale.text}.</span>}
    </p>
  );
}

/** How often the header asks whether the server is out of date. */
export const SERVER_POLL_MS = 60_000;

/**
 * The header's line when toil or Toil UI on disk is newer than the running
 * server (#305), with the command that starts it again. Asked at load and
 * every minute; a server that can't say shows nothing, since the page has
 * nothing true to add.
 */
export function ServerStale({ load }: { load: (() => Promise<ServerStatus | null>) | undefined }) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  useEffect(() => {
    if (!load) return;
    let live = true;
    const read = () =>
      load().then(
        (s) => live && setStatus(s),
        () => undefined,
      );
    void read();
    const t = setInterval(read, SERVER_POLL_MS);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [load]);
  if (!status?.stale) return null;
  return (
    <p className="banner banner--stale" role="status" data-server-stale="">
      <strong>Toil UI is out of date.</strong> {status.stale} Running chats and assignments started on the older one. Stop it with Ctrl+C where it runs, then start it again: <code className="any-break">{status.restart}</code>
    </p>
  );
}
