/**
 * The dashboard's charts (#253), drawn as plain SVG: a sprint burn-up, a
 * throughput sparkline and a cycle-time scatter. No chart library: three
 * small drawings don't need one, and SVG takes the theme's tokens as they
 * are. Each chart is an image with a summary for a screen reader, and has its
 * figures in a table under "Show the figures", so nothing is only visual.
 * Lines draw themselves in once, only where motion is welcome
 * (app.css honours `prefers-reduced-motion`).
 * Charts for the steering group, finally with their working shown.
 */

import { useId, type ReactNode } from 'react';
import { day } from '../format.ts';
import type { Burnup } from '../model/burnup.ts';
import type { Week } from '../model/flow.ts';

const W = 560;
const PAD = { left: 34, right: 12, top: 14, bottom: 26 };
const round1 = (n: number) => Math.round(n * 10) / 10;

function Figures({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="figures">
      <summary>Show the figures</summary>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} scope="col">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function Svg({ label, height, children }: { label: string; height: number; children: ReactNode }) {
  const id = useId();
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-labelledby={id} preserveAspectRatio="xMidYMid meet">
      <title id={id}>{label}</title>
      {children}
    </svg>
  );
}

const ticks = (max: number) => {
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
};

export function BurnupChart({ b, sprint }: { b: Burnup; sprint: string }) {
  const H = 220;
  const total = b.days.length + b.ahead;
  const max = Math.max(1, ...b.days.map((d) => d.scope));
  const x = (i: number) => PAD.left + ((W - PAD.left - PAD.right) * (i + 1)) / Math.max(1, total);
  const y = (v: number) => H - PAD.bottom - ((H - PAD.top - PAD.bottom) * v) / max;
  const x0 = PAD.left;
  const scope = [`${x0},${y(b.days[0]?.scope ?? 0)}`, ...b.days.map((d, i) => `${x(i)},${y(d.scope)}`)].join(' ');
  const done = [`${x0},${y(0)}`, ...b.days.map((d, i) => `${x(i)},${y(d.done)}`)].join(' ');
  const last = b.days.at(-1);
  const area = `${done} ${x(b.days.length - 1)},${y(0)} ${x0},${y(0)}`;
  const label = last
    ? `${sprint} burn-up: ${last.done} of ${last.scope} points done after ${b.days.length} days, with ${b.ahead} days to go.${b.days[0] && last.scope > b.days[0].scope ? ` Scope grew from ${b.days[0].scope} to ${last.scope} points.` : ''}`
    : `${sprint} burn-up: no days yet.`;
  return (
    <figure className="chart-figure">
      <Svg label={label} height={H}>
        {ticks(max).map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        <line className="today" x1={x(b.days.length - 1)} x2={x(b.days.length - 1)} y1={PAD.top} y2={H - PAD.bottom} />
        <polygon className="area" points={area} />
        <polyline className="line line--scope" points={scope} pathLength={1} />
        <polyline className="line line--done" points={done} pathLength={1} />
        <text className="axis" x={x0} y={H - 8}>
          Start
        </text>
        <text className="axis" x={x(b.days.length - 1)} y={H - 8} textAnchor="middle">
          Today
        </text>
        <text className="axis" x={W - PAD.right} y={H - 8} textAnchor="end">
          End
        </text>
      </Svg>
      <figcaption className="legend">
        <span className="key-swatch key-swatch--done" aria-hidden="true" /> Done points <span className="key-swatch key-swatch--scope" aria-hidden="true" /> Scope
        {b.unplaced.length > 0 && <span className="note"> {b.unplaced.length} done items have no recorded finish and aren't drawn.</span>}
      </figcaption>
      <Figures caption={`${sprint} burn-up by day`} head={['Day', 'Scope (points)', 'Done (points)']} rows={b.days.map((d) => [day(d.at), d.scope, d.done])} />
    </figure>
  );
}

export function ThroughputSpark({ weeks }: { weeks: Week[] }) {
  const H = 96;
  const max = Math.max(1, ...weeks.map((w) => w.items.length));
  const slot = (W - PAD.left - PAD.right) / weeks.length;
  const bar = Math.min(48, slot * 0.6);
  const y = (v: number) => H - 22 - ((H - 40) * v) / max;
  const total = weeks.reduce((n, w) => n + w.items.length, 0);
  const label = `Throughput: ${total} items finished in ${weeks.length} weeks, ${weeks.map((w) => w.items.length).join(', ')} by week, oldest first. The last week is still running.`;
  return (
    <figure className="chart-figure">
      <Svg label={label} height={H}>
        <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
        {weeks.map((w, i) => {
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={w.start}>
              <rect className={`bar${w.partial ? ' bar--partial' : ''}`} x={cx - bar / 2} y={y(w.items.length)} width={bar} height={Math.max(0, y(0) - y(w.items.length))} rx={3} />
              <text className="axis axis--value" x={cx} y={y(w.items.length) - 5} textAnchor="middle">
                {w.items.length}
              </text>
              <text className="axis" x={cx} y={H - 6} textAnchor="middle">
                {day(w.start).replace(/ \d{4}$/, '')}
              </text>
            </g>
          );
        })}
      </Svg>
      <Figures caption="Items finished per week" head={['Week of', 'Finished']} rows={weeks.map((w) => [`${day(w.start)}${w.partial ? ' (so far)' : ''}`, w.items.length])} />
    </figure>
  );
}

export interface ScatterPoint {
  id: string;
  label: string;
  end: string;
  days: number;
}

export function CycleScatter({ points, p85 }: { points: ScatterPoint[]; p85: number | null }) {
  const H = 200;
  const ends = points.map((p) => Date.parse(p.end));
  const lo = Math.min(...ends);
  const hi = Math.max(...ends);
  const span = Math.max(1, hi - lo);
  const max = Math.max(1, ...points.map((p) => p.days), p85 ?? 0);
  const x = (t: number) => PAD.left + 10 + ((W - PAD.left - PAD.right - 20) * (t - lo)) / span;
  const y = (v: number) => H - PAD.bottom - ((H - PAD.top - PAD.bottom) * v) / (max * 1.1);
  const label = `Cycle time: ${points.length} finished items, from ${round1(Math.min(...points.map((p) => p.days)))} to ${round1(max)} days.${p85 !== null ? ` 85% finished within ${round1(p85)} days.` : ''}`;
  return (
    <figure className="chart-figure">
      <Svg label={label} height={H}>
        {ticks(Math.ceil(max)).map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={PAD.left - 6} y={y(t) + 4} textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {p85 !== null && (
          <g>
            <line className="p85" x1={PAD.left} x2={W - PAD.right} y1={y(p85)} y2={y(p85)} />
            <text className="axis axis--p85" x={W - PAD.right} y={y(p85) - 5} textAnchor="end">
              85% within {round1(p85)} days
            </text>
          </g>
        )}
        {points.map((p) => (
          <circle key={p.id} className="dot" cx={x(Date.parse(p.end))} cy={y(p.days)} r={6} />
        ))}
        <text className="axis" x={PAD.left} y={H - 8}>
          {day(new Date(lo).toISOString())}
        </text>
        <text className="axis" x={W - PAD.right} y={H - 8} textAnchor="end">
          {day(new Date(hi).toISOString())}
        </text>
      </Svg>
      <Figures caption="Cycle time per finished item" head={['Item', 'Finished', 'Cycle time']} rows={points.map((p) => [p.label, day(p.end), `${round1(p.days)} days`])} />
    </figure>
  );
}
