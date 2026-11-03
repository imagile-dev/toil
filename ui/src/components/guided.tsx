/**
 * Ask with training wheels (#552): what the chat shows before the first
 * question and under every answer, for someone who has never asked an AI
 * anything. The guided start is a few plain questions grouped by what they are
 * for, each with a "Good for" line, beside a "Before you ask" panel that says
 * on the page, not in a tooltip, what the AI can see, what it can't do, who
 * answers and that asking counts toward your usage. Under an answer, "How sure
 * is this?" is a word and one sentence worked out by code (src/model/
 * confidence.ts), "What it looked at" is the items it cited as links, and one
 * line says nothing was changed. Everything here is a view of what the agent
 * already does; none of it asks the model for anything. The terms of use, for
 * once, are shorter than the thing they govern.
 */

import { useState } from 'react';
import { Button } from 'react-aria-components';
import { useData } from '../data.ts';
import { sourceLabel } from '../format.ts';
import { GROUPS, QUESTIONS, questionFor, type GuidedQuestion } from '../guided-questions.ts';
import type { Panel } from '../load.ts';
import type { Answer } from '../agent.ts';
import { ageHoursOf, howSure, type Level } from '../model/confidence.ts';
import { usePlain } from '../plain-words.ts';
import { LearnButton } from './help.tsx';
import { TicketChip } from './items.tsx';
import { useMediaQuery } from './layout.tsx';
import './guided.css';

/** Below this width the questions come first and "Before you ask" folds to a line, so a phone opens on something to press. */
export const PHONE = '(max-width: 699px)';

const list = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the AI is given, counted from the Toil project on screen: the saved copy's items, code reviews, builds and deployments. */
export function seenCounts(d: { items: unknown[]; pullRequests?: unknown[]; changes: Array<{ kind: string }>; deployments: unknown[] }): string[] {
  const builds = d.changes.filter((c) => c.kind === 'build').length;
  return [plural(d.items.length, 'item'), plural((d.pullRequests ?? []).length, 'pull request'), plural(builds, 'build'), plural(d.deployments.length, 'deployment')];
}

/** What the AI can see, what it can't do, who answers and what it costs: the same words open on a desktop and unfolded on a phone. */
function BeforeBody({ answering, noAgent }: { answering: string; noAgent: boolean }) {
  const { dossier } = useData();
  const plain = usePlain();
  const systems = [...new Set(dossier.sources.map((s) => sourceLabel(s.area)))];
  return (
    <dl className="guided-before__list">
      <div>
        <dt>What the AI can see</dt>
        <dd>
          <p>{plain.text("This dossier's saved work:")}</p>
          <ul data-seen="">
            {seenCounts(dossier).map((c) => (
              <li key={c}>{plain.text(c)}</li>
            ))}
          </ul>
          <p className="note">When the saved copy is not enough, it looks things up live in {systems.length ? list(systems) : 'your tools'}, read-only.</p>
        </dd>
      </div>
      <div>
        <dt>What it can&apos;t do</dt>
        <dd>
          <ul>
            <li>Change anything in {systems.length ? list(systems) : 'your tools'}</li>
            <li>See email or chat</li>
            <li>{plain.text('See other dossiers')}</li>
          </ul>
        </dd>
      </div>
      <div>
        <dt>Who answers</dt>
        <dd>
          <p>{noAgent ? plain.text('Nobody yet: no agent is set up.') : <strong>{plain.text(answering)}</strong>}</p>
        </dd>
      </div>
      <div>
        <dt>What it costs</dt>
        <dd>
          <p>Each question you ask counts toward your usage, and every answer shows what it used.</p>
        </dd>
      </div>
    </dl>
  );
}

/**
 * "Before you ask". On a desktop it is always open, beside the questions. On a
 * phone it sits below them as one line and a button, closed until pressed: a
 * small screen opens on the questions, and the line still says the two things
 * that matter most, so a closed panel is never an empty one.
 */
export function BeforeYouAsk({ answering, noAgent }: { answering: string; noAgent: boolean }) {
  const phone = useMediaQuery(PHONE);
  const plain = usePlain();
  const [open, setOpen] = useState(false);
  return (
    <aside className="guided-before" aria-labelledby="guided-before-h" data-before-you-ask="">
      <h3 id="guided-before-h">Before you ask</h3>
      {phone ? (
        <>
          <div className="guided-before__bar">
            <p>{plain.text("It reads this dossier's saved work. It changes nothing.")}</p>
            <Button className="btn" aria-expanded={open} aria-controls="guided-before-body" onPress={() => setOpen(!open)} data-before-toggle="">
              What AI can see
            </Button>
          </div>
          {open && (
            <div id="guided-before-body">
              <BeforeBody answering={answering} noAgent={noAgent} />
            </div>
          )}
        </>
      ) : (
        <BeforeBody answering={answering} noAgent={noAgent} />
      )}
    </aside>
  );
}

/** The chat's empty state: the question to answer, the questions to start from, and what the AI can and can't do. */
export function GuidedStart({ answering, noAgent, notice, details, busy, onPick }: { answering: string; noAgent: boolean; notice?: string; details?: string; busy: boolean; onPick: (q: GuidedQuestion, text: string) => void }) {
  const { dossier } = useData();
  const plain = usePlain();
  return (
    <div className="guided" data-guided-start="">
      <div className="guided__main">
        <h3 className="guided__title">{`What would you like to know about ${dossier.name}?`}</h3>
        {notice && (
          <div className="agent-notice guided__notice" data-no-agent="">
            <p>{plain.text(notice)}</p>
            {details && (
              <details>
                <summary>Details for whoever sets it up</summary>
                <p className="note">{details}</p>
              </details>
            )}
          </div>
        )}
        <p className="note">Pick a question, or type your own below. The answer says what it looked at.</p>
        <LearnButton />
        <div className="guided__groups" role="group" aria-label="Starter questions">
          {GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={`guided-g-${g.id}`}>
              <h4 id={`guided-g-${g.id}`}>{g.title}</h4>
              <ul>
                {g.questions.map((id) => {
                  const q = QUESTIONS[id];
                  const text = plain.text(q.text);
                  return (
                    <li key={id}>
                      <Button className="guided-q" isDisabled={busy} onPress={() => onPick(q, text)} data-question={id}>
                        <span className="guided-q__text">{text}</span>
                        <span className="guided-q__good">Good for: {q.good}</span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
      <BeforeYouAsk answering={answering} noAgent={noAgent} />
    </div>
  );
}

/** Three dots, filled for as many as the level earns: a shape beside the word, so the level never rests on colour alone. */
function Dots({ level }: { level: Level }) {
  const filled = level === 'high' ? 3 : level === 'medium' ? 2 : 1;
  return (
    <svg className="sure__dots" viewBox="0 0 30 10" width="30" height="10" aria-hidden="true" focusable="false">
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={5 + i * 10} cy="5" r="3.4" fill={i < filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.4" />
      ))}
    </svg>
  );
}

const PANEL_WORDS: Record<Panel, string> = { dossier: 'the dossier', work: 'work items', prs: 'pull requests', owners: 'code owners', builds: 'builds', deployments: 'deployments' };

/**
 * Under a finished answer: how sure it is, what it looked at, and that nothing
 * changed. A question from the guided start is checked against the panels it
 * needs and the items it needs a field of; a typed one, or Analyze, against
 * every read and the Toil project's items, which are the generic checks.
 */
export function AnswerChecks({ answer, prompt, analyze }: { answer: Answer; prompt: string; analyze?: boolean }) {
  const { dossier, now, viewedAt } = useData();
  const plain = usePlain();
  const q = analyze ? QUESTIONS.briefing : questionFor(prompt, plain.text);
  const panels = (q?.needs ?? (Object.keys(dossier.calls ?? {}) as Panel[])).filter((p) => dossier.calls?.[p]?.some((c) => !c.ok));
  const lack = q?.lack;
  const among = lack ? dossier.items.filter(lack.among) : [];
  const sure = howSure({
    failed: panels.map((p) => plain.text(PANEL_WORDS[p])),
    ageHours: ageHoursOf(now, viewedAt ?? new Date().toISOString()),
    items: dossier.items.length,
    lacking: lack ? { what: lack.what, count: among.filter(lack.lacks).length, of: among.length } : null,
  });
  return (
    <div className="ask-sure" data-how-sure="">
      <dl>
        <div>
          <dt>How sure is this?</dt>
          <dd>
            <span className={`sure sure--${sure.level}`} data-sure={sure.level}>
              <Dots level={sure.level} />
              <strong>{sure.word}</strong>
            </span>{' '}
            {sure.because}
          </dd>
        </div>
        <div>
          <dt>What it looked at</dt>
          <dd>
            {answer.citations.length ? (
              <ul className="ask-sure__chips" data-looked-at="">
                {answer.citations.map((id) => (
                  <li key={id}>
                    <TicketChip id={id} detail />
                  </li>
                ))}
              </ul>
            ) : (
              <span>It named no items.</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="note ask-sure__safe">Suggestions only. Nothing was changed.</p>
    </div>
  );
}
