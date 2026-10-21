/**
 * The Agents sidebar (#394), beside every dossier tab, or a drawer on a
 * narrower screen: the tracker's inbox, then the dossier's assignments as
 * small cards in three groups, those that need you, those working and those
 * gone stale, with the finished ones folded under Earlier; then Renew all
 * stale, the limits, and the chat's recent analyses. It replaced the Agents
 * lane, a panel halfway down the old dashboard, and reads the same
 * assignments the same way (./views.tsx). Same trays, nearer the desk.
 */

import { ItemLink } from '../components/items.tsx';
import { StaleNote } from '../components/stale.tsx';
import { useChatScope, type Turn } from '../components/ask.tsx';
import { useData } from '../data.ts';
import { analysesHref, dateTime } from '../format.ts';
import { ADAPTER_NAME, MODE_INFO, runMs, runText, type Assignment } from './model.ts';
import { InboxRow, Limits, RenewAll, StateChip, assignmentHref, useAssignments } from './views.tsx';
import './assign.css';

type Group = 'needs-you' | 'working' | 'stale' | 'earlier';
const GROUP_LABEL: Record<Group, string> = { 'needs-you': 'Needs you', working: 'Working', stale: 'Stale', earlier: 'Earlier' };

const inInbox = (a: Assignment) => a.state === 'queued' && a.waiting === 'start';

/** Which group an assignment sits in: what it waits on first, then whether it has gone stale, then everything finished. */
export function groupOf(a: Assignment): Group {
  if (a.state === 'needs-you') return 'needs-you';
  if (a.state === 'working' || a.state === 'queued') return 'working';
  if (a.stale && !a.renewedBy) return 'stale';
  return 'earlier';
}

/** How many need you, for the drawer's button. */
export function useAgentsSummary(): { needsYou: number } {
  const { dossier } = useData();
  const { list } = useAssignments(dossier.name);
  return { needsYou: list?.assignments.filter((a) => a.state === 'needs-you').length ?? 0 };
}

/** One assignment, small: its state, the item, what it waits on, and the way in. */
function AgentCard({ a, now }: { a: Assignment; now: string }) {
  const pending = a.proposals.filter((p) => p.status === 'pending').length;
  const needs = [pending ? `${pending} ${pending === 1 ? 'proposal' : 'proposals'} to review` : '', a.questions.length ? `${a.questions.length} ${a.questions.length === 1 ? 'question' : 'questions'}` : ''].filter(Boolean).join(', ');
  return (
    <li className="agent-card" data-card="">
      <p className="agent-card__top">
        <StateChip a={a} /> <span className="assign-mode">{MODE_INFO[a.mode].label}</span>
      </p>
      <p className="agent-card__item">
        <ItemLink id={a.item} /> <span className="agent-card__title">{a.itemTitle}</span>
      </p>
      <p className="note">
        {a.state === 'needs-you' && needs ? `${needs}. ` : ''}
        {a.state === 'failed' && a.stop ? `${a.stop.message} ` : ''}
        {a.adapter ? ADAPTER_NAME[a.adapter] : 'No adapter yet'} · {runText(a.ranMs ?? runMs(a, now))}
      </p>
      {a.stale && <StaleNote stale={a.stale} />}
      {a.renewedBy && (
        <p className="note">
          Renewed as <a href={assignmentHref(a.dossier, a.renewedBy)}>a fresh assignment</a>.
        </p>
      )}
      <a className="agent-card__open" href={assignmentHref(a.dossier, a.id)}>
        Open<span className="sr-only"> the assignment on {a.item}</span>
      </a>
    </li>
  );
}

/** The chat's Analyze answers, newest first: what the Analyses tab shows in full. */
export function analysesOf(turns: Turn[]): Turn[] {
  return turns.filter((t) => t.analyze).reverse();
}

function RecentAnalyses() {
  const { dossier } = useData();
  const chat = useChatScope();
  const list = analysesOf(chat?.turns ?? []).slice(0, 3);
  return (
    <section className="agents-side__analyses" aria-labelledby="recent-analyses">
      <h3 id="recent-analyses">Recent analyses</h3>
      {list.length ? (
        <ul className="plain">
          {list.map((t) => (
            <li key={t.id} className="analysis-line">
              <span className="note">{dateTime(new Date(t.started).toISOString())}</span>{' '}
              {t.error ? <span className="failure">Didn't finish.</span> : t.done ? <span>{summaryOf(t)}</span> : <span className="note">Still answering.</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">None yet in this session. Analyze, in the bar above, asks for one.</p>
      )}
      <a href={analysesHref(dossier.name)}>All analyses</a>
    </section>
  );
}

/** The first sentence of an answer, its citations as plain ids, for a one-line summary. */
export function summaryOf(t: Turn): string {
  const text = (t.answer?.parts.map((p) => p.text).join(' ') ?? '').replace(/\[\[([^\]]+)\]\]/g, (_, id: string) => id.slice(id.indexOf(':') + 1)).replace(/\s+/g, ' ').trim();
  const first = /^(.{1,140}?[.!?])(\s|$)/.exec(text)?.[1] ?? text.slice(0, 140);
  return first.length < text.length && !/[.!?]$/.test(first) ? `${first}…` : first;
}

/** The sidebar itself, the same inside the drawer and beside the view. */
export function AgentsSidebar() {
  const { dossier, now, assignments: api } = useData();
  const { list, error, reload } = useAssignments(dossier.name);
  const inbox = list?.assignments.filter(inInbox) ?? [];
  const rest = list?.assignments.filter((a) => !inInbox(a)) ?? [];
  const groups = (['needs-you', 'working', 'stale', 'earlier'] as const).map((g) => ({ g, items: rest.filter((a) => groupOf(a) === g) }));
  return (
    <section className="agents-sidebar" aria-labelledby="agents">
      <h2 id="agents">Agents</h2>
      {list && (
        <p className="note">
          {list.settings.concurrent === 1 ? 'One runs at a time' : `${list.settings.concurrent} run at a time`}, for up to {list.settings.timeLimitMinutes} minutes each.
        </p>
      )}
      {!api && <p className="note">Assigning work to an agent isn't available here.</p>}
      {api?.disabled && <p className="note">{api.disabled}</p>}
      {error && <p className="failure">{error}</p>}
      {list?.settings.problem && <p className="failure">{list.settings.problem}</p>}
      {inbox.length > 0 && (
        <section className="assign-inbox" aria-labelledby="agent-inbox">
          <h3 id="agent-inbox">Agent inbox</h3>
          <p className="note">The tracker asks for an agent on these. Nothing runs until you press Start.</p>
          <ul className="rows">
            {inbox.map((a) => (
              <InboxRow key={a.id} a={a} onStarted={reload} />
            ))}
          </ul>
        </section>
      )}
      {list && !rest.length && <p className="note">Nothing assigned to an agent in {dossier.name} yet. Assign an item from its card's menu on the board, or from its page.</p>}
      {groups.map(({ g, items }) =>
        items.length === 0 ? null : g === 'earlier' ? (
          <details key={g} className="agents-group agents-group--earlier">
            <summary>
              {GROUP_LABEL[g]} ({items.length})
            </summary>
            <ul className="agent-cards">
              {items.map((a) => (
                <AgentCard key={a.id} a={a} now={now} />
              ))}
            </ul>
          </details>
        ) : (
          <section key={g} className={`agents-group agents-group--${g}`} aria-labelledby={`agents-${g}`}>
            <h3 id={`agents-${g}`}>
              {GROUP_LABEL[g]} <span className="count">{items.length}</span>
            </h3>
            <ul className="agent-cards">
              {items.map((a) => (
                <AgentCard key={a.id} a={a} now={now} />
              ))}
            </ul>
          </section>
        ),
      )}
      {list && <RenewAll list={list} onDone={reload} />}
      {list && <Limits list={list} onSaved={reload} />}
      <RecentAnalyses />
    </section>
  );
}
