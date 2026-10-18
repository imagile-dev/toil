/**
 * The agent pane: starter questions about the dossier on screen, and answers
 * whose citations link to its items. An agent that fails says so in the pane,
 * never only in the console. It reads; it never changes a ticket.
 */

import { useState } from 'react';
import type { Answer } from '../agent.ts';
import { useData } from '../data.ts';
import { useSkins } from '../skins.tsx';
import { Cited } from './items.tsx';

export function Ask() {
  const { agent, dossier } = useData();
  const { EmptyState } = useSkins();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const ask = async (prompt: string) => {
    setBusy(true);
    setFailed(null);
    try {
      setAnswer(await agent.ask(dossier.name, prompt));
    } catch (e: unknown) {
      setAnswer(null);
      setFailed(`The agent couldn't answer: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="ask" aria-labelledby="ask">
      <h2 id="ask">Ask about {dossier.name}</h2>
      <p className="note">Answers cite the items they rest on. The agent reads; it never changes a ticket.</p>
      <div className="starters">
        {agent.starters(dossier.name).map((s) => (
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
