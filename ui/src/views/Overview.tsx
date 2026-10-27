/**
 * A dossier's home (#494, replacing #394's Overview): the briefing, one layer
 * at a time. The recommendation first, as a sentence; then the reasons behind
 * it, each one line, the first open; each item a row that opens its drawer;
 * what is on track counted, not listed; and, one step in, anything the
 * dossier's focus left out or the code flagged that Analyze didn't mention.
 * The numbers wait behind a fold, and every other view is a quiet link away
 * as well as a tab. Analyze writes it when its latest answer is current;
 * otherwise code does, and the page says which (principle 4). Briefing notes,
 * with the appendix stapled to the back rather than the front.
 */

import { useMemo, type ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Sparkline } from '../components/charts.tsx';
import { briefingSource, Customize, PeekLinks, useBriefing } from '../components/briefing.tsx';
import { useBriefingPrefs } from '../briefing-prefs.ts';
import { parseRoute } from '../App.tsx';
import { Help } from '../components/help.tsx';
import { Cited, PrLink } from '../components/items.tsx';
import { useData, useDerived } from '../data.ts';
import { analysesHref, analysisHref, boardHref, dependenciesHref, itemHref, peekHref, peopleHref, personText, prsHref, shortKey, sourceLabel, worklogHref } from '../format.ts';
import { Empty, TrackerAction } from '../components/empty.tsx';
import { burnup } from '../model/burnup.ts';
import { aging, cycleTimes, throughput } from '../model/flow.ts';
import { WAITING_LABEL, daysText, openQueue } from '../model/prs.ts';
import type { BriefingReason } from '../model/briefing.ts';
import { useSkins, useWords } from '../skins.tsx';
import { Aging, CycleTime, SprintDetail, Throughput } from './Flow.tsx';

const round1 = (n: number) => Math.round(n * 10) / 10;

export function Overview() {
  const { dossier } = useData();
  const { health: h } = useDerived();
  const view = useBriefing();
  const prefs = useBriefingPrefs();
  // A red reason (failing checks, blocked) can be folded but never hidden: principle 4 outranks a layout preference.
  const shown = view.reasons.filter((r) => r.severity === 'danger' || !prefs.hidden.includes(r.lens));
  const hidden = view.reasons.length - shown.length;
  const here = typeof window === 'undefined' ? '#/' : window.location.hash;
  // Whose settings tuned this briefing, whenever a dossier tunes it (#494): its file, and whether it's the reader's own.
  const tuned = dossier.analyze && Object.keys(dossier.analyze).length ? dossier.origin : null;
  return (
    <section className="briefing" aria-label="Briefing" data-rec-source={view.by === 'analyze' ? 'analysis' : 'code'}>
      <p className="briefing__meta">
        {h && (
          <span>
            {h.sprint.name}, day {h.days.gone} of {h.days.total}
          </span>
        )}
        <span className="briefing__by source" data-briefing-by={view.by}>
          {briefingSource(view)}
          {view.stale && `. ${view.stale}`}
          {view.analysis && (
            <>
              {' · '}
              <a href={analysisHref(dossier.name, view.analysis.id)} data-rec-analysis="">
                Open the analysis
              </a>
            </>
          )}
        </span>
        <Customize lenses={view.reasons.filter((r) => r.severity !== 'danger').map((r) => ({ lens: r.lens, label: r.label }))} />
        {tuned && (
          <span className="source" data-focus-from="">
            Analyze settings from {tuned.file}, {tuned.adopted ? 'your own dossier' : "a dossier you haven't adopted"}
          </span>
        )}
      </p>
      <Links page={prefs.opensIn === 'page'}>
        <h2 className="sr-only">Recommendation</h2>
        <p className="briefing__head">{view.recommendation ? <Cited text={view.recommendation} /> : 'Nothing needs anyone right now.'}</p>
        {view.problems.map((p) => (
          <p key={p} className="briefing__warning" role="note">
            {p}
          </p>
        ))}
        {view.unknown.length > 0 && (
          <p className="briefing__warning" role="note">
            Analyze named {view.unknown.length === 1 ? 'an item' : `${view.unknown.length} items`} that {view.unknown.length === 1 ? "isn't" : "aren't"} this dossier's: <code>{view.unknown.join(', ')}</code>. Treat {view.unknown.length === 1 ? 'it' : 'them'} as unverified.
          </p>
        )}
        <section aria-labelledby="why-title">
          <h2 id="why-title" className="briefing__label">
            Why <Help topic="briefing" />
          </h2>
          <div className="reasons">
            {shown.map((r, i) => (
              <Reason key={`${r.lens}-${i}`} reason={r} open={i === 0 && prefs.firstOpen} here={here} />
            ))}
            <div className="reason reason--quiet">
              <p className="reason__line">
                <span className="reason__dot reason__dot--ok" aria-hidden="true" />
                <span className="reason__title">
                  <b>On track.</b> <span>{view.onTrack}</span>
                  {hidden > 0 && <span> {hidden === 1 ? 'One reason is' : `${hidden} reasons are`} hidden under Customize.</span>}
                </span>
              </p>
            </div>
            {view.unchecked.length > 0 && (
              <details className="reason" data-unchecked="">
                <summary>
                  <span className="reason__dot" aria-hidden="true" />
                  <span className="reason__title">
                    <b>Couldn't check.</b> <span>{view.unchecked.map((u) => u.label).join(', ')}</span>
                  </span>
                </summary>
                <div className="reason__body">
                  {view.unchecked.map((u) => (
                    <p key={u.label}>
                      {u.label}: {u.note}
                    </p>
                  ))}
                </div>
              </details>
            )}
            {view.leftOut.length > 0 && (
              <details className="reason" data-left-out="">
                <summary>
                  <span className="reason__dot" aria-hidden="true" />
                  <span className="reason__title">
                    <b>Left out by the dossier's focus.</b> <span>Analyze set these aside because of "leave out".</span>
                  </span>
                  <span className="reason__count">{view.leftOut.length}</span>
                </summary>
                <div className="reason__body">{view.leftOut.map((l) => <Row key={l.id} id={l.id} note={l.why} here={here} />)}</div>
              </details>
            )}
            {view.notMentioned.length > 0 && (
              <details className="reason" data-not-mentioned="">
                <summary>
                  <span className="reason__dot reason__dot--warn" aria-hidden="true" />
                  <span className="reason__title">
                    <b>Flagged by code, not in the briefing.</b> <span>Analyze didn't mention these.</span>
                  </span>
                  <span className="reason__count">{view.notMentioned.length}</span>
                </summary>
                <div className="reason__body">{view.notMentioned.map((i) => <Row key={i.id} id={i.id} note={i.why} here={here} />)}</div>
              </details>
            )}
          </div>
        </section>
        {view.changed.length > 0 && (
          <section aria-labelledby="changed-title">
            <h2 id="changed-title" className="briefing__label">
              Since the last briefing
            </h2>
            <ul className="rows">
              {view.changed.map((c, i) => (
                <li key={i}>
                  <Cited text={c} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </Links>
      <details className="briefing__numbers" open={prefs.numbersOpen}>
        <summary>The numbers</summary>
        <MetricStrip />
      </details>
      <nav className="briefing__links" aria-label={`More on ${dossier.name}`}>
        <span className="briefing__label">Go to</span>
        <a href={boardHref(dossier.name)}>Board</a>
        <a href={dependenciesHref(dossier.name)}>Dependencies</a>
        <a href={prsHref(dossier.name)}>Pull requests</a>
        <a href={peopleHref(dossier.name)}>People</a>
        <a href={worklogHref(dossier.name)}>Worklog</a>
        <a href={analysesHref(dossier.name)}>Analyses</a>
      </nav>
    </section>
  );
}

/** Item links on the briefing: to the drawer, unless the person chose the item's page under Customize. */
function Links({ page, children }: { page: boolean; children: ReactNode }) {
  return page ? <>{children}</> : <PeekLinks>{children}</PeekLinks>;
}

/** One reason: a line, folded; open, its items as rows that open the drawer, or its text. */
function Reason({ reason: r, open, here }: { reason: BriefingReason; open: boolean; here: string }) {
  return (
    <details className="reason" open={open} data-reason={r.lens}>
      <summary>
        <span className={`reason__dot reason__dot--${r.severity}`} aria-hidden="true" />
        <span className="reason__title">
          <b>{r.label}.</b> <span>{r.line}</span>
        </span>
        {r.items.length > 0 && <span className="reason__count">{r.items.length}</span>}
      </summary>
      <div className="reason__body">
        {r.text && (
          <p>
            <Cited text={r.text} />
          </p>
        )}
        {r.items.map((i) => (
          <Row key={i.id} id={i.id} here={here} />
        ))}
      </div>
    </details>
  );
}

/** One item as a row: key, title and who, opening its drawer; a note under it when there's one to give. */
function Row({ id, here, note }: { id: string; here: string; note?: string }) {
  const { byId, dossier } = useData();
  const { opensIn } = useBriefingPrefs();
  const item = byId.get(id);
  const current = parseRoute(here).peek === id;
  return (
    <>
      <a className="reason-row" href={opensIn === 'page' ? itemHref(dossier.name, id) : peekHref(here, id)} aria-current={current ? 'true' : undefined} data-row={id}>
        <span className="reason-row__key">{item ? `${sourceLabel(item.source.area)} ${shortKey(item)}` : id}</span>
        <span className="reason-row__title">{item?.title ?? 'Not in this dossier'}</span>
        <span className="reason-row__who">{item ? personText(item.assignee) : ''}</span>
      </a>
      {note && (
        <p className="note">
          <Cited text={note} />
        </p>
      )}
    </>
  );
}

/** One metric: its name, its figure in words, a sparkline, and, pressed, its full chart in a dialog. */
function Metric({ id, label, value, unit, spark, title, children }: { id: string; label: string; value: string; unit: string; spark: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="metric">
      <DialogTrigger>
        {/* Its name is its visible words, then what pressing does, so voice control finds it by what it shows (WCAG 2.5.3). */}
        <Button className="metric__button" data-metric={id}>
          <span className="metric__label">{label}</span>{' '}
          <span className="metric__figure">
            <span className="metric__value">{value}</span> <span className="metric__unit">{unit}</span>
          </span>
          <span className="sr-only">, show the full chart</span>
          {spark}
        </Button>
        <ModalOverlay className="feedback-overlay" data-backdrop="" isDismissable>
          <Modal className="feedback-modal chart-modal">
            <Dialog className="feedback-dialog chart-dialog">
              {({ close }) => (
                <div className="chart-dialog__body">
                  <div className="chart-dialog__head">
                    <Heading slot="title">{title}</Heading>
                    <Button className="btn btn--small" onPress={close} data-chart-close="">
                      Close
                    </Button>
                  </div>
                  {children}
                </div>
              )}
            </Dialog>
          </Modal>
        </ModalOverlay>
      </DialogTrigger>
    </li>
  );
}

/** The metrics as sparklines (#394): burn-up, throughput, cycle time, aging work in progress and pull request wait. */
function MetricStrip() {
  const { dossier, now, byId, sync } = useData();
  const { health: h, insights: p } = useDerived();
  const words = useWords();
  // A theme's sprint dressing (Harvest's calendar) hangs on the sprint wherever it shows.
  const { Panel: PanelSkin } = useSkins();
  // Worked out once per dossier and clock: the chat above re-renders the page as each answer streams in.
  const { b, t, cycles, ages, queue } = useMemo(
    () => ({
      b: h ? burnup(h, now) : null,
      t: throughput(dossier.items, now),
      cycles: cycleTimes(dossier.items).known.sort((x, y) => (x.end < y.end ? -1 : 1)),
      ages: aging(dossier.items, now).known,
      queue: openQueue(dossier.pullRequests ?? [], byId, now).filter((r) => r.wait.on !== 'draft'),
    }),
    [h, dossier, now, byId],
  );
  const last = b?.days.at(-1);
  const full = t.weeks.filter((w) => !w.partial);
  const mean = full.length ? full.reduce((n, w) => n + w.items.length, 0) / full.length : 0;
  const waits = queue.map((r) => r.wait.days ?? 0);
  const longest = waits.length ? Math.max(...waits) : 0;
  return (
    <section className="overview-metrics" aria-labelledby="metrics-title">
      <h2 id="metrics-title" className="sr-only">
        Metrics
      </h2>
      <ul className="metric-strip">
        <Metric
          id="burnup"
          label="Burn-up"
          value={last ? `${last.done} of ${last.scope}` : 'No sprint'}
          unit={last ? 'points' : ''}
          spark={<Sparkline values={b?.days.map((d) => d.done) ?? []} against={b?.days.map((d) => d.scope) ?? []} />}
          title={h ? `${h.sprint.name}: day ${h.days.gone} of ${h.days.total}` : 'Sprint'}
        >
          {h ? (
            <div className="chart-dialog__sprint">
              <PanelSkin id="sprint">
                <SprintDetail h={h} />
              </PanelSkin>
            </div>
          ) : (
            <Empty message={words('empty.sprint')} action={<TrackerAction dossier={dossier.name} sync={sync} />} />
          )}
        </Metric>
        <Metric id="throughput" label="Throughput" value={String(round1(mean))} unit="a week" spark={<Sparkline kind="bars" values={t.weeks.map((w) => w.items.length)} />} title="Throughput">
          <Throughput />
        </Metric>
        <Metric
          id="cycle"
          label="Cycle time"
          value={p.p85 ? `${round1(p.p85.days)}` : String(cycles.length)}
          unit={p.p85 ? 'days, 85% within' : cycles.length === 1 ? 'item timed' : 'items timed'}
          spark={<Sparkline values={cycles.map((c) => c.days)} mark={p.p85?.days ?? null} />}
          title="Cycle time"
        >
          <CycleTime />
        </Metric>
        <Metric id="aging" label="Aging WIP" value={String(ages.length)} unit={ages.length ? `in progress, oldest ${round1(ages[0]!.days)} d` : 'in progress'} spark={<Sparkline kind="bars" values={ages.map((a) => a.days)} mark={p.p85?.days ?? null} />} title="Aging work in progress">
          <p className="note">{words('aging.note')}</p>
          <Aging />
        </Metric>
        <Metric id="pr-wait" label="PR wait" value={queue.length ? String(round1(longest)) : '0'} unit={queue.length ? `working days, ${queue.length} open` : 'open'} spark={<Sparkline kind="bars" values={waits} />} title="Pull requests waiting">
          {queue.length ? (
            <ul className="rows">
              {queue.map((r) => (
                <li key={r.change.id}>
                  <PrLink change={r.change} withTitle />
                  <p className="evidence">
                    Waits on {WAITING_LABEL[r.wait.on].toLowerCase()}
                    {r.wait.days !== null ? ` for ${daysText(r.wait.days)}` : ''}: {r.wait.why}.
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No pull request is open, apart from drafts.</p>
          )}
          <p>
            <a href={prsHref(dossier.name)}>The Pull requests tab</a> has the whole queue, its flags and its flow.
          </p>
        </Metric>
      </ul>
    </section>
  );
}
