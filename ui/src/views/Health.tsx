/**
 * Sprint health: the numbers a sprint review asks for, each list linking to the
 * items behind it, and the agent pane beside them. Every figure here comes from
 * src/model/sprint.ts, so the page, the tests and the scripted answers agree,
 * a level of alignment the steering committee is still minuting.
 */

import { useState } from 'react';
import type { Answer } from '../agent.ts';
import { Cited, ItemLink } from '../components/items.tsx';
import { useData } from '../data.ts';
import { day, dateTime, estimateText, sourceLabel } from '../format.ts';
import { describe, health, type Health as HealthData } from '../model/sprint.ts';
import { useSkins } from '../skins.tsx';

const pts = (n: number) => `${n} ${n === 1 ? 'point' : 'points'}`;

export function Health() {
  const { items, changes, info, byId } = useData();
  const { EmptyState } = useSkins();
  const h = health(items, changes, info.syncedAt);
  if (!h) {
    return (
      <>
        <h1 tabIndex={-1}>Sprint health</h1>
        <EmptyState message="No sprint is running in the synced data." />
      </>
    );
  }
  const total = h.done.points + h.remaining.points;
  const listed = (kind: 'added' | 'carried') => h.items.filter((i) => h.entries.get(i.id)?.kind === kind);

  return (
    <>
      <div className="view-head">
        <h1 tabIndex={-1}>Sprint health</h1>
        <p className="lede">
          {h.sprint.name}, {day(h.sprint.start!)} to {day(h.sprint.end!)}: day {h.days.gone} of {h.days.total} working days.
        </p>
      </div>

      <div className="health">
        <div className="health-main">
          <ul className="stats" aria-label="Sprint figures">
            <Stat label="Done" value={`${h.done.points} of ${total}`} note={`points, ${h.done.count} items`} />
            <Stat label="Planned" value={String(h.planned.points)} note={`points, ${h.planned.count} items`} />
            <Stat label="Added mid-sprint" value={String(h.added.points)} note={`points, ${h.added.count} items`} />
            <Stat label="Carried over" value={String(h.carried.points)} note={`points, ${h.carried.count} items`} />
          </ul>
          <div className="meter" role="img" aria-label={`${h.done.points} of ${total} points done`}>
            <span style={{ width: `${total ? (100 * h.done.points) / total : 0}%` }} />
          </div>
          {h.otherUnits.length > 0 && (
            <p className="note">
              Points totals leave out items estimated in other units:{' '}
              {h.otherUnits.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <ItemLink id={id} /> ({estimateText(byId.get(id)!)})
                </span>
              ))}
              .
            </p>
          )}

          <section aria-labelledby="risk">
            <h2 id="risk">At risk</h2>
            <ul className="rows">
              {h.risks.map((r) => (
                <li key={r.id}>
                  <ItemLink id={r.id} withTitle />
                  <ul className="reasons">
                    {r.reasons.map((reason, i) => (
                      <li key={i}>
                        <Cited text={describe(reason)} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="added">
            <h2 id="added">Added after the sprint started</h2>
            <EntryList h={h} ids={listed('added').map((i) => i.id)} />
          </section>

          <section aria-labelledby="carried">
            <h2 id="carried">Carried over</h2>
            <EntryList h={h} ids={listed('carried').map((i) => i.id)} />
          </section>

          <section aria-labelledby="sources">
            <h2 id="sources">Each tracker's sprint</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Tracker</th>
                    <th scope="col">Sprint</th>
                    <th scope="col">Starts</th>
                    <th scope="col">Ends</th>
                  </tr>
                </thead>
                <tbody>
                  {h.sprint.sources.map((s) => (
                    <tr key={s.connection}>
                      <td>
                        {sourceLabel(items.find((i) => i.id.startsWith(`${s.connection}:`))!.source.area)} <code>{s.connection}</code>
                      </td>
                      <td>{s.path ?? s.name}</td>
                      <td>{dateTime(s.start!)}</td>
                      <td>{dateTime(s.end!)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <Ask />
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <li className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      <span className="stat-note">{note}</span>
    </li>
  );
}

function EntryList({ h, ids }: { h: HealthData; ids: string[] }) {
  const { byId } = useData();
  if (!ids.length) return <p>None.</p>;
  return (
    <ul className="rows">
      {ids.map((id) => {
        const e = h.entries.get(id)!;
        const item = byId.get(id)!;
        return (
          <li key={id}>
            <ItemLink id={id} withTitle />
            <p className="evidence">
              {e.from ? `From ${e.from}` : 'Added'}
              {e.at ? ` on ${dateTime(e.at)}` : ''}, {pts(item.estimate?.unit === 'points' ? item.estimate.value : 0)}
              {item.estimate ? '' : ' (no estimate)'}. Source: <code>{e.evidence}</code>
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** The agent pane: starter questions, and answers whose citations link to the items. */
function Ask() {
  const { agent } = useData();
  const { EmptyState } = useSkins();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);

  const [failed, setFailed] = useState<string | null>(null);

  // An agent that fails says so in the pane, never only in the console.
  const ask = async (prompt: string) => {
    setBusy(true);
    setFailed(null);
    try {
      setAnswer(await agent.ask(prompt));
    } catch (e: unknown) {
      setAnswer(null);
      setFailed(`The agent couldn't answer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="ask" aria-labelledby="ask">
      <h2 id="ask">Ask about this sprint</h2>
      <p className="note">Answers cite the items they rest on. The agent reads; it never changes a ticket.</p>
      <div className="starters">
        {agent.starters().map((s) => (
          <button key={s.id} type="button" onClick={() => ask(s.id)} disabled={busy} aria-pressed={answer?.prompt === s.label}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="answer" aria-live="polite">
        {failed ? (
          <p role="alert" className="failure">
            {failed}
          </p>
        ) : answer ? (
          <>
            <h3>{answer.prompt}</h3>
            {answer.parts.map((p, i) => (
              <p key={i}>
                <Cited text={p.text} />
              </p>
            ))}
            <p className="by">
              Cites {answer.citations.length} items. Answered by: {answer.by === 'scripted' ? 'a scripted preview, not a model' : answer.by}.
            </p>
          </>
        ) : (
          <EmptyState message="Pick a question to see how answers cite their sources." />
        )}
      </div>
    </aside>
  );
}
