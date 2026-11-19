/**
 * The Command Center (#307): every work item in the toil project with its
 * readiness verdict and, for each one that isn't ready, the rows that say
 * why, with filters by verdict, status, type, assignee and source. Every
 * verdict is src/model/readiness.ts over the cached OWI records, with no
 * model call and no live read.
 *
 * The plan is strict: only `ready` items are slated, in the toil project's own
 * order. Starting them is assign-to-agent's (#293): `startReady` on the
 * view's data (src/assign/start.ts) queues an implement assignment for each,
 * and the view says what it queued, or why it started nothing. Where there
 * are no assignments the button stays disabled and says so. Mission control, minus the
 * missions until the paperwork for #293 clears.
 *
 * Where the toil project names ticket rules (#657), a "Ticket rules" card says,
 * one line a standard, how many of the open items its rules apply to miss
 * them; each line is a full-width button that filters the list to those items
 * (`?rule=<standard>/<rule>` for a one-rule standard, `?rule=<standard>` for
 * any rule of one with several), and the filtered rule's line leads each
 * item's "Why not ready", so the figure and the items behind it are one press
 * apart. This is the Tickets tab (#657); the sprint board is a drill-in from
 * here and from the Summary, "Open the board", a quiet button on the heading row. The ready items fold to one
 * line, "16 ready" and its Start button, with the items one press in; the filter bar sits with the table it filters.
 */

import { useMemo, useState } from 'react';
import { Button } from 'react-aria-components';
import { Choice } from '../components/choice.tsx';
import { ItemLink, ItemRow } from '../components/items.tsx';
import { DisclosureBody, SummaryChevron } from '../components/disclosure.tsx';
import { Card, CardGrid, Cluster, DataTable, Stack, type Column } from '../components/layout.tsx';
import { Panel } from '../components/panel.tsx';
import { Help } from '../components/help.tsx';
import { FilterBar } from '../components/filter-bar.tsx';
import { VerdictChip, WhyNot } from '../components/readiness.tsx';
import { useData } from '../data.ts';
import { asMapped } from '../model/people.ts';
import { toWhere } from '../filters.ts';
import { useAddress, useWorkInsights } from '../insights-data.ts';
import { boardHref, dateTime, toilProjectHref, personText, sourceLabel, STATUS_CATEGORY_LABEL } from '../format.ts';
import { NavButton } from '../components/nav-button.tsx';
import { useFocusArrival } from '../motion.ts';
import { usePlain } from '../plain-words.ts';
import { BLOCKED_WHY, readinessAll, tally, VERDICT_LABEL, VERDICT_PLAIN, VERDICTS, withRules, type Readiness, type Row, type Verdict } from '../model/readiness.ts';
import { lineWhat, matchesRef, missing, ruleLines, ruleName } from '../rules.ts';
import { Unread } from '../components/unread.tsx';
import { Empty, EmptyButton } from '../components/empty.tsx';
import type { Person, WorkItem } from '../toil.ts';
import { AgentMark } from '../components/agent-mark.tsx';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

interface Line {
  item: WorkItem;
  readiness: Readiness;
  /** The assignee as the toil project's people map them, so one person with two accounts is one name in the column and the filter. */
  assignee: Person | null;
}

/** A short id for a plan, from what is in it: the items, in order, and the state each was read in. */
export function planId(items: WorkItem[]): string {
  let h = 0x811c9dc5;
  for (const c of items.map((i) => `${i.id}@${i.updated ?? ''}@${i.status ?? ''}`).join('\n')) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const STATUS_FILTER = [
  { id: 'open', label: 'Not done' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

/** The list's columns; with a ticket rule filtered on, its line leads each item's "Why not ready". */
const columnsFor = (ruleRef: string | null): Array<Column<Line>> => [
  { header: 'Item', label: 'Item', rowHeader: true, cell: (l) => <ItemLink id={l.item.id} withTitle /> },
  { header: 'Verdict', label: 'Verdict', cell: (l) => <VerdictChip verdict={l.readiness.verdict} /> },
  { header: 'Why not ready', label: 'Why not ready', cell: (l) => <WhyNot readiness={l.readiness} {...(ruleRef ? { first: (r: Row) => Boolean(r.rule && matchesRef(ruleRef, r.rule)) } : {})} /> },
  { header: 'Assignee', label: 'Assignee', cell: (l) => personText(l.assignee) },
  { header: 'Status', label: 'Status', cell: (l) => `${l.item.status ?? 'None'} (${STATUS_CATEGORY_LABEL[l.item.statusCategory]})` },
];

export function CommandCenter() {
  const { toilProject, now, startReady, rules } = useData();
  const plain = usePlain();
  const [started, setStarted] = useState<{ ok: boolean; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const settings = useMemo(() => withRules(toilProject.readiness, rules?.reading), [toilProject, rules]);
  // The shared filter bar (#567), the Board's own: "Fix version: 2.4" narrows this list, its tally and its plan alike.
  const ins = useWorkInsights();
  const { filters, query, hrefWith } = useAddress();
  // A ticket rule's line drills here: the list keeps only the items that miss it.
  const ruleRef = query.get('rule');
  const checked = rules?.view?.result ?? null;
  const missingRule = ruleRef && checked ? missing(checked, ruleRef) : null;
  const lines = useMemo<Line[]>(() => {
    const all = readinessAll(toilProject.items, settings);
    const where = toWhere(filters);
    const allowed = where.length === 0 ? null : new Set(ins.narrow(where).items.map((i) => i.id));
    return toilProject.items.flatMap((item, i) => (allowed && !allowed.has(item.id) ? [] : [{ item, readiness: all[i]!, assignee: asMapped(toilProject.people ?? [], item.source.area, item.assignee) }]));
  }, [toilProject, settings, ins, filters]);
  const [verdict, setVerdict] = useState<'all' | Verdict>('all');
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [source, setSource] = useState('all');

  const open = lines.filter((l) => l.item.statusCategory !== 'DONE');
  const totals = tally(open.map((l) => l.readiness));
  const slated = open.filter((l) => l.readiness.verdict === 'ready');
  const plan = { id: planId(slated.map((l) => l.item)), items: slated.map((l) => l.item.id) };
  const typeOf = (i: WorkItem) => i.typeName ?? i.type;
  const who = (l: Line) => (l.assignee ? personText(l.assignee) : '');
  const types = [...new Set(lines.map((l) => typeOf(l.item)))].sort();
  const people = [...new Set(lines.map(who).filter(Boolean))].sort();
  const areas = [...new Set(lines.map((l) => l.item.source.area))].sort();
  const shown = lines.filter(
    (l) =>
      (status === 'all' || (status === 'done') === (l.item.statusCategory === 'DONE')) &&
      (verdict === 'all' || l.readiness.verdict === verdict) &&
      (type === 'all' || typeOf(l.item) === type) &&
      (assignee === 'all' || (assignee === 'none' ? !l.assignee : who(l) === assignee)) &&
      (source === 'all' || l.item.source.area === source) &&
      (!ruleRef || !missingRule || missingRule.has(l.item.id)),
  );
  // Opened from a rule's line or the Summary's Ticket rules card, the filter it set is brought into view and ringed (src/motion.ts).
  useFocusArrival(ruleRef ? `rule:${ruleRef}` : null);
  const withRule = (ref: string | null) => hrefWith((q) => (ref ? q.set('rule', ref) : q.delete('rule')));
  const showRules = settings.standards.length > 0 || (checked?.standards.length ?? 0) > 0;
  const linesOfRules = checked ? ruleLines(checked, open.map((l) => l.item)) : [];
  const missed = linesOfRules.filter((r) => r.miss > 0 || r.skipped > 0);
  const met = linesOfRules.filter((r) => r.miss === 0 && r.skipped === 0).reduce((n, r) => n + r.rules.length, 0);
  const calls = [...toilProject.calls.toilProject, ...toilProject.calls.work];

  return (
    <>
      <div className="view-head">
        <p className="eyebrow">
          <a href={toilProjectHref(toilProject.name)}>{toilProject.name}</a>
        </p>
        <div className="view-head__row">
          <h1 tabIndex={-1} title={plain.title('Command Center')}>
            {plain.pw('Command Center', 'Ready to start?')}
          </h1>
          <NavButton href={boardHref(toilProject.name)} kind="quiet" size="sm" data-open-board="">
            Open the board
          </NavButton>
        </div>
        <p className="lede">
          {plain.on ? `Every item in ${toilProject.name}, marked ready or not and, if not, why, from the records read ${dateTime(now)}.` : <>Every work item in {toilProject.name}, each with its readiness verdict and, where it isn't ready, why, from the records read {dateTime(now)}.</>} <Help topic="readiness" />
        </p>
        {settings.notes.map((n, i) => (
          <p key={i} role="note" className="failure">
            {n}
          </p>
        ))}
      </div>

      <CardGrid as="ul" min="sm" className="team-strip readiness-tally" aria-label="Open items by verdict">
        {VERDICTS.map((v) => (
          <li key={v}>
            <Stack gap="xs" className="team-tile">
              <h2 className="readiness-tally__head">
                <VerdictChip verdict={v} />
              </h2>
              <p className="team-figure">{totals[v]}</p>
              <p className="note">{v === 'ready' ? 'Every check passes.' : v === 'thin' ? plain.pw('Missing acceptance criteria, description or another check a person can waive.', 'Missing "done when" criteria, a description or another check a person can waive.') : BLOCKED_WHY}</p>
            </Stack>
          </li>
        ))}
      </CardGrid>

      {showRules && (
        <Card as="section" className="panel readiness-rules" aria-labelledby="ticket-rules" data-ticket-rules="">
          <h2 id="ticket-rules">
            Ticket rules <Help topic="ticket-rules" />
          </h2>
          {rules?.reading.state === 'failed' ? (
            <p role="alert" className="failure">
              Couldn't check the ticket rules: {rules.reading.message}
            </p>
          ) : !checked ? (
            <p>
              <Unread /> <span aria-hidden="true">not read yet</span>
            </p>
          ) : linesOfRules.length === 0 ? (
            <p>No open item here is one the rules apply to.</p>
          ) : (
            <>
              {missed.length > 0 && (
                <ul className="plain readiness-rules__lines">
                  {missed.map((r) => (
                    <li key={r.ref}>
                      <NavButton href={withRule(r.ref)} kind="quiet" row aria-current={ruleRef === r.ref ? 'true' : undefined} data-rule-line={r.ref}>
                        <strong>
                          {r.miss} of {r.applies}
                        </strong>{' '}
                        {r.noun(r.applies)}: {lineWhat(r)}
                        {r.skipped > 0 && <span className="note">, {r.skipped} not checked</span>}
                      </NavButton>
                    </li>
                  ))}
                </ul>
              )}
              {met > 0 && <p className="note">{missed.length === 0 ? `Every open item meets all ${count(met, 'rule')}.` : `Every open item meets the other ${count(met, 'rule')}.`}</p>}
            </>
          )}
        </Card>
      )}

      <Card as="section" className="panel readiness-slate" aria-labelledby="slate">
        {/* One line, the count and its button (#657); the items it would start are one press in, so the card isn't a list. */}
        <div className="readiness-slate__line">
          <h2 id="slate" title={slated.length ? `Plan ${plan.id}` : undefined}>
            {slated.length ? `${slated.length} ready` : 'Nothing ready'}
          </h2>
          <span className="control-row__group">
          <Button
            className="btn btn--sm"
            isDisabled={!startReady || slated.length === 0 || starting}
            onPress={async () => {
              if (!startReady) return;
              setStarting(true);
              try {
                setStarted({ ok: true, text: await startReady(plan) });
              } catch (e) {
                setStarted({ ok: false, text: e instanceof Error ? e.message : String(e) });
              } finally {
                setStarting(false);
              }
            }}
            aria-label={`Start ${count(slated.length, 'ready item')}`}
            {...(startReady ? {} : { 'aria-describedby': 'slate-note' })}
          >
            <AgentMark />
            Start {slated.length}
          </Button>
          {startReady && <Help topic="start-ready" />}
          </span>
        </div>
        {slated.length > 0 ? (
          <details className="readiness-slate__items">
            <summary>
              <SummaryChevron />
              {plain.text(`Which ${slated.length === 1 ? 'one' : count(slated.length, 'item')}, in the Toil project's order`)}
            </summary>
            <DisclosureBody>
              <ul className="plain item-rows" aria-label="Slated items">
                {slated.map((l) => (
                  <li key={l.item.id}>
                    <ItemRow id={l.item.id} />
                  </li>
                ))}
              </ul>
            </DisclosureBody>
          </details>
        ) : (
          <p className="note">No open item is ready, so nothing would be slated. The list below says what each one is missing.</p>
        )}
        {/* What Start does is in its (i) (principle 11, #657); only the state that it can't start stays on screen. */}
        {!startReady && (
          <p id="slate-note" className="note">
            {plain.text('This view has no agent assignments, so it shows the plan it would start.')}
          </p>
        )}
        <p className={started && !started.ok ? 'failure' : 'note'} role="status">
          {started?.text ?? ''}
        </p>
      </Card>

      <Panel id="cc-items" title="Items" calls={calls}>
        <FilterBar period={false} />
        <Cluster className="readiness-filters" role="group" aria-label="Filter the items">
          <Choice label="Verdict" value={verdict} onChange={(v) => setVerdict(v as 'all' | Verdict)} options={[{ id: 'all', label: 'All' }, ...VERDICTS.map((v) => ({ id: v, label: (plain.on ? VERDICT_PLAIN : VERDICT_LABEL)[v] }))]} />
          <Choice label="Status" value={status} onChange={setStatus} options={STATUS_FILTER} />
          <Choice label="Type" value={type} onChange={setType} options={[{ id: 'all', label: 'All' }, ...types.map((t) => ({ id: t, label: t }))]} />
          <Choice label="Assignee" value={assignee} onChange={setAssignee} options={[{ id: 'all', label: 'Anyone' }, { id: 'none', label: 'Unassigned' }, ...people.map((p) => ({ id: p, label: p }))]} />
          {areas.length > 1 && <Choice label="Source" value={source} onChange={setSource} options={[{ id: 'all', label: 'All' }, ...areas.map((a) => ({ id: a, label: `${sourceLabel(a)} (${a})` }))]} />}
        </Cluster>
        {ruleRef && (
          <p className="readiness-rule-filter" data-rule-filter={ruleRef} data-focus-id={`rule:${ruleRef}`}>
            <span>
              Missing: <strong>{(checked && ruleName(checked, ruleRef)) ?? ruleRef}</strong>
              {checked && !missingRule && <span className="note"> (not one of this Toil project's rules)</span>}
            </span>
            <a className="btn btn--small" href={withRule(null)}>
              Clear<span className="sr-only"> the ticket rule filter</span>
            </a>
          </p>
        )}
        <p className="note" aria-live="polite">
          Showing {count(shown.length, 'item')} of {lines.length}.
        </p>
        {shown.length ? (
          <DataTable label="Items and their readiness" caption={`${toilProject.name}'s items and their readiness`} columns={columnsFor(ruleRef)} rows={shown} rowKey={(l) => l.item.id} wide />
        ) : (
          <Empty
            message="No item matches these filters."
            action={
              <EmptyButton
                onPress={() => {
                  setVerdict('all');
                  setStatus('all');
                  setType('all');
                  setAssignee('all');
                  setSource('all');
                }}
              >
                Show every item
              </EmptyButton>
            }
          />
        )}
      </Panel>
    </>
  );
}
