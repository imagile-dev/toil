/**
 * A dossier's Overview (#394), in the Minto order: the recommendation first,
 * then the three key issues behind it, each with its tickets as chips, then
 * the evidence: the metrics as a strip of sparklines, each opening its full
 * chart, and the blockers in brief: the critical chain as a compact Gantt (#396). It fits a 1440 by 900 screen without
 * scrolling. The recommendation is the latest Analyze's when the dossier has
 * one (#395), with when it was made and a link to it; otherwise it is worked
 * out by code (src/model/recommend.ts), with no agent asked. It says which. The answer before the slides, for once.
 */

import { useMemo, type ReactNode } from 'react';
import { Button, Dialog, DialogTrigger, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Sparkline } from '../components/charts.tsx';
import { Help } from '../components/help.tsx';
import { Cited, PrLink, TicketChip } from '../components/items.tsx';
import { Card } from '../components/layout.tsx';
import { useData, useDerived } from '../data.ts';
import { analysisHref, boardHref, dateTime, dependenciesHref, prsHref } from '../format.ts';
import { whoText } from '../components/analysis.tsx';
import { useChatScope } from '../components/ask.tsx';
import { burnup } from '../model/burnup.ts';
import { aging, cycleTimes, throughput } from '../model/flow.ts';
import { WAITING_LABEL, daysText, openQueue } from '../model/prs.ts';
import { recommend, type IssueTab, type KeyIssue } from '../model/recommend.ts';
import { useSkins, useWords } from '../skins.tsx';
import { Aging, CycleTime, SprintDetail, Throughput } from './Flow.tsx';
import { ChainGantt } from './Gantt.tsx';

const round1 = (n: number) => Math.round(n * 10) / 10;
const TAB_NAME: Record<IssueTab, string> = { board: 'Board', dependencies: 'Dependencies', prs: 'Pull requests' };

export function Overview() {
  const { dossier, now } = useData();
  const { health: h, insights: p } = useDerived();
  const rec = useMemo(() => recommend({ items: dossier.items, pullRequests: dossier.pullRequests ?? [], prepared: p, health: h, readiness: dossier.readiness, now }), [dossier, now, h, p]);
  // The latest Analyze's recommendation when there is one (#395); the code's otherwise, and the card says which.
  const latest = useChatScope()?.history.list?.[0] ?? null;
  const analysis = latest?.recommendation ? latest : null;
  return (
    <div className="overview">
      <Card as="section" className="panel overview-rec" aria-labelledby="rec-title" data-rec-source={analysis ? 'analysis' : 'code'}>
        <div className="overview-head">
          <h2 id="rec-title" className="overview-label">
            Recommendation <Help topic="recommendation" />
          </h2>
          <p className="note overview-rec__how">
            {analysis ? (
              <>
                <span className="overview-rec__source">From the latest Analyze</span>, <time dateTime={analysis.at}>{dateTime(analysis.at)}</time>, by {whoText(analysis)}.{' '}
                <a href={analysisHref(dossier.name, analysis.id)} data-rec-analysis="">
                  Open the analysis
                </a>
              </>
            ) : (
              <>
                <span className="overview-rec__source">Worked out by code</span>
                {rec.derivedFrom.replace(/^Worked out by code/, '')}
                {latest ? ' The latest Analyze had no recommendation line.' : ' No Analyze kept for this dossier yet.'}
              </>
            )}
          </p>
        </div>
        <p className={`overview-rec__headline${analysis ? ' overview-rec__headline--analysis' : ''}`}>
          {analysis ? <Cited text={analysis.recommendation!} chips /> : <Cited text={rec.headline} />}
        </p>
      </Card>

      <section className="overview-issues" aria-labelledby="issues-title">
        <h2 id="issues-title" className="overview-label">
          Key issues
        </h2>
        {rec.issues.length ? (
          <ol className="issue-cards">
            {rec.issues.map((i) => (
              <IssueCard key={i.kind} issue={i} />
            ))}
          </ol>
        ) : (
          <p className="note">No issue stands out: nothing is blocked, failing, waiting on review or aging.</p>
        )}
      </section>

      <MetricStrip />
      <Blockers />
    </div>
  );
}

function tabHref(dossier: string, tab: IssueTab): string {
  return tab === 'prs' ? prsHref(dossier) : tab === 'dependencies' ? dependenciesHref(dossier) : boardHref(dossier);
}

function IssueCard({ issue }: { issue: KeyIssue }) {
  const { dossier } = useData();
  const more = issue.count - issue.tickets.length;
  return (
    <li className="issue-card" data-card="">
      <h3 className={`issue-card__title issue-card__title--${issue.kind}`}>{issue.title}</h3>
      <p className="issue-card__detail">
        <Cited text={issue.detail} />
      </p>
      <ul className="ticket-chips" aria-label={`Tickets: ${issue.title}`}>
        {issue.tickets.map((id) => (
          <li key={id}>
            <TicketChip id={id} />
          </li>
        ))}
      </ul>
      <p className="issue-card__foot note">
        <a href={tabHref(dossier.name, issue.tab)}>
          {more > 0 ? `${more} more on ` : 'Open '}
          {TAB_NAME[issue.tab]}
        </a>
      </p>
    </li>
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
  const { dossier, now, byId } = useData();
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
            <p>{words('empty.sprint')}</p>
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

/**
 * The blockers in brief (#396): the critical chain as a compact Gantt, the
 * chain of open blockers holding the most points, on the sprint's timeline.
 * The Dependencies tab has every blocker, the key and the table.
 */
function Blockers() {
  const { dossier } = useData();
  return (
    <section className="overview-blockers" aria-labelledby="blockers-title">
      <div className="overview-head">
        <h2 id="blockers-title" className="overview-label">
          Blockers
        </h2>
        <a className="note" href={dependenciesHref(dossier.name)}>
          All dependencies
        </a>
      </div>
      <ChainGantt />
    </section>
  );
}
