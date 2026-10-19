/**
 * Flow panels (#252, #253): the sprint burn-up, throughput per week, cycle
 * time and aging work in progress, all from OWI transitions (src/model/flow.ts
 * and burnup.ts). Each lists what it couldn't compute and why, beside what it
 * could. The "needs attention" list ranks the dossier's open items by their
 * insights (src/model/insights.ts), each insight with what it rests on.
 */

import { Avatar, InsightChips } from '../components/bits.tsx';
import { BurnupChart, CycleScatter, ThroughputSpark } from '../components/charts.tsx';
import { Cited, ItemLink } from '../components/items.tsx';
import { useData, useDerived } from '../data.ts';
import { dateTime, shortKey, sourceLabel } from '../format.ts';
import { burnup } from '../model/burnup.ts';
import { aging, cycleTimes, throughput, type Unknown } from '../model/flow.ts';
import { AGING_PERCENTILE, INSIGHT_LABEL, MIN_CYCLES, needsAttention } from '../model/insights.ts';
import { useSkins, useWords } from '../skins.tsx';

const round1 = (n: number) => Math.round(n * 10) / 10;
const daysText = (n: number) => `${round1(n)} ${round1(n) === 1 ? 'day' : 'days'}`;

function Unknowns({ list, what }: { list: Unknown[]; what: string }) {
  if (!list.length) return null;
  return (
    <div className="unknowns">
      <p className="note">
        {list.length} {list.length === 1 ? 'item has' : 'items have'} no {what} the data can show:
      </p>
      <ul className="plain">
        {list.map((u) => (
          <li key={u.id}>
            <ItemLink id={u.id} /> <span className="field">Unknown: {u.reason}.</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Burnup() {
  const { now } = useData();
  const { health: h } = useDerived();
  const { EmptyState } = useSkins();
  const words = useWords();
  if (!h) return <EmptyState message={words('empty.burnup')} />;
  return <BurnupChart b={burnup(h, now)} sprint={h.sprint.name} />;
}

export function Throughput() {
  const { dossier, now } = useData();
  const t = throughput(dossier.items, now);
  const total = t.weeks.reduce((n, w) => n + w.items.length, 0);
  const full = t.weeks.filter((w) => !w.partial);
  const mean = full.length ? full.reduce((n, w) => n + w.items.length, 0) / full.length : 0;
  return (
    <>
      <p className="big-figure">
        <span className="big-number">{round1(mean)}</span> items a week
        <span className="note"> over the last {full.length} full weeks; {total} finished in {t.weeks.length} weeks.</span>
      </p>
      <ThroughputSpark weeks={t.weeks} />
      <p className="note">Counted in the week of each item's last move into Done, from its history.</p>
      <Unknowns list={t.unknown} what="finish date" />
    </>
  );
}

export function CycleTime() {
  const { dossier, byId } = useData();
  const { insights } = useDerived();
  const c = cycleTimes(dossier.items);
  const points = c.known.map((k) => {
    const item = byId.get(k.id)!;
    return { id: k.id, label: `${sourceLabel(item.source.area)} ${shortKey(item)}`, end: k.end, days: k.days };
  });
  return (
    <>
      {points.length ? (
        <>
          <p className="big-figure">
            {insights.p85 ? (
              <>
                <span className="big-number">{round1(insights.p85.days)}</span> days for {AGING_PERCENTILE}% of items
              </>
            ) : (
              <>
                <span className="big-number">{points.length}</span> {points.length === 1 ? 'item' : 'items'} timed
              </>
            )}
            <span className="note"> From the first move into In progress to the last into Done.</span>
          </p>
          <CycleScatter points={points} p85={insights.p85?.days ?? null} />
          {!insights.p85 && <p className="note">Fewer than {MIN_CYCLES} cycle times, so no percentile yet, and nothing is flagged as aging.</p>}
        </>
      ) : (
        <p>No finished item here has a cycle time the data can show.</p>
      )}
      <Unknowns list={c.unknown} what="cycle time" />
    </>
  );
}

export function Aging() {
  const { dossier, now, byId } = useData();
  const { insights } = useDerived();
  const a = aging(dossier.items, now);
  const max = Math.max(1, ...a.known.map((k) => k.days), insights.p85?.days ?? 0);
  return (
    <>
      {a.known.length ? (
        <ul className="aging">
          {a.known.map((k) => {
            const item = byId.get(k.id)!;
            const over = insights.p85 !== null && k.days > insights.p85.days;
            return (
              <li key={k.id} className={over ? 'aging--over' : undefined}>
                <div className="aging-row">
                  <ItemLink id={k.id} withTitle />
                  <span className="aging-days">
                    {daysText(k.days)}
                    {over && <span className="flag"> past p{AGING_PERCENTILE}</span>}
                  </span>
                </div>
                <div className="aging-bar" aria-hidden="true">
                  <span style={{ width: `${(100 * k.days) / max}%` }} />
                  {insights.p85 && <i style={{ left: `${(100 * insights.p85.days) / max}%` }} />}
                </div>
                <p className="evidence">
                  <Avatar person={item.assignee} /> {item.status}, in progress since {dateTime(k.since)}. Source: <code>history.transitions</code>
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p>Nothing in progress has a recorded start.</p>
      )}
      {insights.p85 && <p className="note">The marker on each bar is p{AGING_PERCENTILE} of this dossier's cycle times, {daysText(insights.p85.days)}.</p>}
      <Unknowns list={a.unknown} what="start" />
    </>
  );
}

export function Attention() {
  const { insights } = useDerived();
  const list = needsAttention(insights);
  if (!list.length) return <p>Nothing open needs attention.</p>;
  return (
    <ol className="attention">
      {list.map((a, rank) => (
        <li key={a.id} className={`attention-item attention-item--w${a.insights[0]!.weight}`}>
          <span className="rank" aria-hidden="true">
            {rank + 1}
          </span>
          <div>
            <ItemLink id={a.id} withTitle />
            <InsightChips insights={a.insights} max={4} />
            <ul className="reasons">
              {a.insights.map((i) => (
                <li key={i.code}>
                  <span className="sr-only">{INSIGHT_LABEL[i.code]}: </span>
                  <Cited text={i.text} />. <span className="field">Source: <code>{i.evidence}</code></span>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
    </ol>
  );
}
