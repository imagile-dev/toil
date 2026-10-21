/**
 * The Analyses tab (#394): every Analyze pulse check asked in this session,
 * newest first, each with when it was asked, who answered and the answer
 * with its citations. They live in the dossier's chat, so a reload clears
 * them, as it clears the chat. Minutes of the meeting, taken by the meeting.
 */

import { Button } from 'react-aria-components';
import { ANALYZE } from '../agent.ts';
import { Cited } from '../components/items.tsx';
import { Card } from '../components/layout.tsx';
import { useChatScope } from '../components/ask.tsx';
import { analysesOf } from '../assign/sidebar.tsx';
import { dateTime } from '../format.ts';

export function Analyses() {
  const chat = useChatScope();
  const list = analysesOf(chat?.turns ?? []);
  return (
    <div className="tab-panels">
      <Card as="section" className="panel analyses" aria-labelledby="analyses-title">
        <h2 id="analyses-title">Analyses</h2>
        <p className="note">Analyze asks the agent for a pulse check: what changed, who is on what, what is stuck, and the sprint's health. Each one asked in this session is here, newest first, until the page is reloaded.</p>
        {chat && (
          <p>
            <Button className="btn" onPress={() => void chat.ask(ANALYZE, 'Analyze')} isDisabled={chat.busy} data-analyze-tab="">
              Analyze now
            </Button>
          </p>
        )}
        {list.length ? (
          <ol className="analyses__list">
            {list.map((t) => (
              <li key={t.id} className="analysis">
                <p className="note">
                  Asked {dateTime(new Date(t.started).toISOString())}
                  {t.answer?.by ? `, answered by ${t.answer.by}` : ''}
                  {!t.done ? ', still answering' : t.stopped ? ', stopped' : ''}.
                </p>
                {t.error ? (
                  <p className="failure">{t.error}</p>
                ) : (
                  t.answer?.parts.map((p, i) => (
                    <p key={i} className="analysis__text">
                      <Cited text={p.text} />
                    </p>
                  ))
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p>No analysis yet in this session.</p>
        )}
      </Card>
    </div>
  );
}
