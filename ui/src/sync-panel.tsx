/**
 * The sync panel (#250): what the local app's cache holds and how fresh it
 * is, for every dossier and each of its sources, with Sync now and Wipe the
 * cache. It sits beside the App rather than inside it (src/local.tsx), so the
 * views stay functions of their data and the preview never shows it.
 *
 * While a sync runs the panel polls `api/sync` once a second and says what
 * toil is doing (requests, pages, retries) in a polite live region. A source
 * whose latest sync failed shows toil's message and fix, and says its data is
 * the last good copy. The wipe asks first, in the page, with Cancel focused.
 * A progress bar that knows what it's measuring, which is rarer than it sounds.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { dateTime, sourceLabel } from './format.ts';
import type { DossierState, SyncClient, SyncStatus } from './server-client.ts';
import './sync-panel.css';

/** How often a running sync is polled. */
export const POLL_MS = 1000;

export interface SyncPanelProps {
  client: SyncClient;
  /** A sync finished or the cache was wiped: the views should read again. */
  onChange: (status: SyncStatus) => void;
  pollMs?: number;
}

/** The newest sync time across the dossiers, which is when the views' data was read. */
export function lastSynced(status: SyncStatus | null): string | null {
  const times = (status?.dossiers ?? []).map((d) => d.lastSyncAt).sort();
  return times.length ? times[times.length - 1]! : null;
}

function DossierRow({ dossier }: { dossier: DossierState }) {
  const failed = dossier.sources.filter((s) => s.status === 'failed');
  return (
    <li className="sync-dossier">
      <p>
        <strong>{dossier.name}</strong> <span className="sync-when">synced {dateTime(dossier.lastSyncAt)}</span>
      </p>
      {/* A dossier whose own read failed (dossiers show) keeps its sources as they were, so the error is the dossier's. */}
      {dossier.status === 'failed' && failed.length === 0 && <p className="sync-bad">The latest sync couldn't read this dossier: {dossier.error}</p>}
      {dossier.sources.length > 0 && (
        <ul className="sync-sources" aria-label={`${dossier.name} sources`}>
          {dossier.sources.map((s) => (
            <li key={s.area} className={s.status === 'failed' ? 'sync-bad' : undefined}>
              {s.status === 'ok' ? (
                <>
                  {sourceLabel(s.area)} <span className="sync-area">({s.area})</span>: up to date
                </>
              ) : (
                <>
                  {sourceLabel(s.area)} <span className="sync-area">({s.area})</span>: failed {dateTime(s.lastAttemptAt)}. {s.error} {s.fix}{' '}
                  <strong>{s.stale && s.lastSuccessAt ? `Showing the last good copy, from ${dateTime(s.lastSuccessAt)}.` : 'Nothing synced from it yet.'}</strong>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function SyncPanel({ client, onChange, pollMs = POLL_MS }: SyncPanelProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [announce, setAnnounce] = useState('');
  const wasRunning = useRef(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const wipeButton = useRef<HTMLButtonElement>(null);

  const take = useCallback(
    (next: SyncStatus) => {
      setStatus(next);
      setProblem(null);
      if (wasRunning.current && !next.job.running) {
        const failed = next.dossiers.flatMap((d) => d.sources).filter((s) => s.status === 'failed').length;
        setAnnounce(next.job.error ? `The sync stopped: ${next.job.error}` : failed ? `Sync finished; ${failed} source${failed === 1 ? '' : 's'} failed.` : 'Sync finished.');
        onChange(next);
      }
      wasRunning.current = next.job.running;
    },
    [onChange],
  );
  const fail = (e: unknown) => setProblem(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    client.status().then(take, fail);
  }, [client, take]);

  const running = status?.job.running === true;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => client.status().then(take, fail), pollMs);
    return () => clearInterval(timer);
  }, [running, client, take, pollMs]);

  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  const start = () => {
    setAnnounce('Sync started.');
    wasRunning.current = true;
    client.start().then(take, fail);
  };
  const closeConfirm = () => {
    setConfirming(false);
    wipeButton.current?.focus();
  };
  const wipe = () => {
    client.wipe().then((next) => {
      setConfirming(false);
      take(next);
      setAnnounce('The cache is wiped. Nothing synced is left on this machine.');
      onChange(next);
      wipeButton.current?.focus();
    }, fail);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeConfirm();
  };

  const job = status?.job;
  const last = lastSynced(status);
  return (
    <aside className="sync-panel" aria-labelledby="sync-heading">
      <div className="sync-inner">
        <div className="sync-head">
          <h2 id="sync-heading">Sync</h2>
          <p className="sync-when">
            {!status ? 'Reading the cache…' : last ? `Last synced ${dateTime(last)}. Kept ${status.retentionDays} days.` : 'Nothing synced yet: press Sync now to read your dossiers through toil.'}
          </p>
          <div className="sync-actions">
            <button type="button" onClick={start} disabled={!status || running}>
              {running ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" ref={wipeButton} onClick={() => setConfirming(true)} disabled={!status || running} aria-expanded={confirming} aria-controls="sync-confirm">
              Wipe the cache…
            </button>
          </div>
        </div>

        <p role="status" className="sync-live">
          {running && job ? `Syncing ${job.dossier ?? 'the dossiers'}: ${job.dossiersDone} of ${job.dossiersTotal || '?'} dossiers, ${job.requests} requests, ${job.pages} pages${job.retries ? `, ${job.retries} retries` : ''}. ${job.messages[job.messages.length - 1] ?? ''}` : announce}
        </p>
        {running && job && job.dossiersTotal > 0 && (
          <progress className="sync-progress" max={job.dossiersTotal} value={job.dossiersDone} aria-label="Dossiers synced" />
        )}
        {problem && (
          <p role="alert" className="sync-bad">
            {problem}
          </p>
        )}
        {job && !running && job.error && <p className="sync-bad">The last sync stopped: {job.error}</p>}

        {confirming && (
          <div className="sync-confirm" id="sync-confirm" role="group" aria-labelledby="sync-confirm-text" onKeyDown={onKey}>
            <p id="sync-confirm-text">
              Delete everything Toil UI synced to this machine? The dashboards will be empty until the next sync, which fetches everything again. Your trackers are not touched.
            </p>
            <div className="sync-actions">
              <button type="button" className="sync-danger" onClick={wipe}>
                Wipe it
              </button>
              <button type="button" ref={cancel} onClick={closeConfirm}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {status && status.dossiers.length > 0 && (
          <ul className="sync-dossiers" aria-label="Dossiers in the cache">
            {status.dossiers.map((d) => (
              <DossierRow key={d.name} dossier={d} />
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
