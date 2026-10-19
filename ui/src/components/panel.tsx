/**
 * A dashboard panel and the line under it that says which toil commands fed
 * it, with each call's exact input and whether it failed. A failed call is an
 * alert on its own panel carrying toil's message and fix, so a broken
 * connection is obvious where it matters and nowhere else (principle 4).
 * Provenance on every panel: the auditors' favourite feature, unrequested.
 */

import type { ReactNode } from 'react';
import { useSkins } from '../skins.tsx';
import type { Call } from '../toil.ts';

/** `toil jira get-changelog` ×8: each command once, with how many calls it took. */
export function commandsOf(calls: Call[]): Array<{ command: string; count: number }> {
  const out: Array<{ command: string; count: number }> = [];
  for (const c of calls) {
    const seen = out.find((x) => x.command === c.command);
    if (seen) seen.count++;
    else out.push({ command: c.command, count: 1 });
  }
  return out;
}

export function Sources({ calls, alerts = true }: { calls: Call[]; alerts?: boolean }) {
  if (!calls.length) return null;
  const commands = commandsOf(calls);
  const failed = alerts ? calls.filter((c) => !c.ok) : [];
  return (
    <>
      {failed.map((c, i) => (
        <p key={i} role="alert" className="failure">
          <code>toil {c.command}</code> failed: {c.error}
        </p>
      ))}
      <details className="fed-by">
        <summary>
          Fed by{' '}
          {commands.map((c, i) => (
            <span key={c.command}>
              {i > 0 && ', '}
              <code>toil {c.command}</code>
              {c.count > 1 && ` ×${c.count}`}
            </span>
          ))}
        </summary>
        <ul className="plain calls">
          {calls.map((c, i) => (
            <li key={i}>
              <code>
                execute({JSON.stringify(c.command)}, {JSON.stringify(c.input)})
              </code>
              {!c.ok && <span className="failure"> (failed)</span>}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

export function Panel({ id, title, calls, children, alerts = true }: { id: string; title: string; calls: Call[]; children: ReactNode; alerts?: boolean }) {
  const { Panel: Skin } = useSkins();
  return (
    <section className="panel" aria-labelledby={id}>
      <Skin id={id}>
        <h2 id={id}>{title}</h2>
        {children}
        <Sources calls={calls} alerts={alerts} />
      </Skin>
    </section>
  );
}
