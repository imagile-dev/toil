/**
 * Usage of toil (#309): what toil's own audit log says about how toil is
 * used on this machine, from `toil audit stats` and, for one command's
 * recent failures, `toil audit list`. Both read only the local log and run
 * read-only through the config path, like every other read on these pages.
 * Nothing here is sent anywhere, and nothing is counted that the log
 * doesn't hold: a call's code and outcome, never its input or its result.
 *
 * Four questions, one call each: how many calls a day, which commands are
 * used most, which fail most (with their top error and its usual fix, and
 * the lines behind it on request), and which front door they came through.
 * Then the commands nobody called. Metrics about the metrics, reviewed by
 * the metrics committee, which has not met.
 */

import { useEffect, useId, useState } from 'react';
import type { AuditLine, UnusedCommand, UsageGroup } from '../../../../src/audit/stats.ts';
import { CallsPerDay } from '../../components/charts.tsx';
import { Card, DataTable } from '../../components/layout.tsx';
import { Help } from '../../components/help.tsx';
import type { ConfigApi } from '../../config.ts';
import { dateTime, day } from '../../format.ts';
import type { Envelope } from '../../toil.ts';
import { doorLabel, failingMost, failuresInput, fillDays, unusedByArea, USAGE_CALLS, type UsageStats } from '../../usage.ts';

const percent = (n: number, of: number) => (of === 0 ? '0%' : `${Math.round((n / of) * 100)}%`);
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type Loaded<T> = { ok: true; data: T } | { ok: false; message: string };

const loadedFrom = <T,>(e: Envelope): Loaded<T> => (e.ok ? { ok: true, data: e.data as T } : { ok: false, message: `${e.error.message}${e.error.fix ? ` ${e.error.fix}` : ''}` });

async function load<T>(config: ConfigApi, command: string, input: Record<string, unknown>): Promise<Loaded<T>> {
  try {
    return loadedFrom<T>(await config.run(command, input));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export function Usage({ config, today = new Date().toISOString().slice(0, 10) }: { config: ConfigApi; today?: string }) {
  const [stats, setStats] = useState<{ days: Loaded<UsageStats>; commands: Loaded<UsageStats>; doors: Loaded<UsageStats> } | null>(null);
  useEffect(() => {
    let live = true;
    // One end for all three, so the figures agree: each call adds its own line to the log as it runs.
    const until = new Date().toISOString();
    const stats = (input: Record<string, unknown>) => load<UsageStats>(config, 'audit stats', { ...input, until });
    Promise.all([stats(USAGE_CALLS.days), stats(USAGE_CALLS.commands), stats(USAGE_CALLS.doors)]).then(([days, commands, doors]) => {
      if (live) setStats({ days, commands, doors });
    });
    return () => {
      live = false;
    };
  }, [config]);

  if (!stats) return <p className="skin-loading">Reading toil's audit log with toil audit stats…</p>;
  const failed = [stats.days, stats.commands, stats.doors].find((s): s is { ok: false; message: string } => !s.ok);
  if (failed || !stats.days.ok || !stats.commands.ok || !stats.doors.ok) {
    return (
      <div role="alert" className="failure">
        <p>
          <code>toil audit stats</code> failed: {failed?.message}
        </p>
      </div>
    );
  }
  const days = stats.days.data;
  const commands = stats.commands.data;
  const doors = stats.doors.data;
  const t = commands.totals;
  const failing = failingMost(commands.groups).slice(0, 8);
  return (
    <>
      <Card as="section" className="panel usage" aria-labelledby="usage-totals">
        <h2 id="usage-totals">Usage of toil</h2>
        <p className="lede">
          From <code>toil audit stats</code>, since {day(commands.window.since)}, UTC. <Help topic="audit" />
        </p>
        <dl className="fields usage-totals">
          <dt>Calls</dt>
          <dd>{t.calls}</dd>
          <dt>Failed</dt>
          <dd>
            {t.failed} ({percent(t.failed, t.calls)})
          </dd>
          <dt>Wrote</dt>
          <dd>
            {t.writes} ({percent(t.writes, t.calls)})
          </dd>
          <dt>Time per call</dt>
          <dd>
            {ms(t.durationMs.median)} median, {ms(t.durationMs.p95)} at the 95th percentile
          </dd>
        </dl>
        {t.calls === 0 && <p className="note">No command has run in this window yet. Each call toil makes, from the CLI, MCP or Toil UI, adds a line.</p>}
        <CallsPerDay days={fillDays(days.groups, days.window.since, days.window.until ? new Date(Date.parse(days.window.until) - 1).toISOString().slice(0, 10) : today)} />
      </Card>

      <Card as="section" className="panel" aria-labelledby="usage-doors">
        <h2 id="usage-doors">How toil was called</h2>
        <p className="lede">
          By front door: the CLI, MCP (an agent), or a program through toil's API, which Toil UI is. From <code>toil audit stats --by via --by caller</code>.
        </p>
        <DataTable
          label="Calls by front door"
          caption="Calls by front door"
          rows={doors.groups}
          rowKey={(g) => `${g.via}:${g.caller}`}
          columns={[
            { header: 'Front door', label: 'Front door', rowHeader: true, cell: (g) => doorLabel(g.via, g.caller) },
            { header: 'Calls', label: 'Calls', cell: (g) => `${g.calls} (${percent(g.calls, doors.totals.calls)})` },
            { header: 'Failed', label: 'Failed', cell: (g) => g.failed },
          ]}
        />
      </Card>

      <Card as="section" className="panel" aria-labelledby="usage-top">
        <h2 id="usage-top">Used most</h2>
        <DataTable
          label="Commands used most"
          caption="The commands called most"
          rows={commands.groups.slice(0, 10)}
          rowKey={(g) => g.command ?? ''}
          columns={[
            { header: 'Command', label: 'Command', rowHeader: true, cell: (g) => <code>{g.command}</code> },
            { header: 'Calls', label: 'Calls', cell: (g) => g.calls },
            { header: 'Failed', label: 'Failed', cell: (g) => g.failed },
            { header: 'Median', label: 'Median', cell: (g) => ms(g.durationMs.median) },
            { header: 'Last', label: 'Last called', cell: (g) => dateTime(g.lastSeen) },
          ]}
        />
      </Card>

      <Card as="section" className="panel" aria-labelledby="usage-failing">
        <h2 id="usage-failing">Failed most</h2>
        <p className="lede">
          Each with its top error code and the fix that usually applies. <Help topic="audit-failures" />
        </p>
        {failing.length === 0 ? (
          <p>No command failed in this window.</p>
        ) : (
          <ul className="usage-failing">
            {failing.map((g) => (
              <li key={g.command}>
                <Failing group={g} config={config} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" className="panel" aria-labelledby="usage-unused">
        <h2 id="usage-unused">Not used</h2>
        <Unused unused={commands.unused ?? []} />
      </Card>
    </>
  );
}

function Failing({ group: g, config }: { group: UsageGroup; config: ConfigApi }) {
  const [lines, setLines] = useState<Loaded<AuditLine[]> | 'loading' | null>(null);
  const id = useId();
  const top = g.errors[0];
  const toggle = async () => {
    if (lines !== null && lines !== 'loading') return setLines(null);
    setLines('loading');
    setLines(await load<AuditLine[]>(config, 'audit list', failuresInput(g.command ?? '')));
  };
  return (
    <Card className="usage-fail">
      <h3>
        <code>{g.command}</code>
      </h3>
      <p>
        Failed {g.failed} of {plural(g.calls, 'call')}
        {top ? (
          <>
            , most often with <code>{top.code}</code> ({top.count})
          </>
        ) : null}
        .
      </p>
      {top?.fix && <p className="note">Usual fix: {top.fix}</p>}
      {g.errors.length > 1 && (
        <p className="note">
          Also:{' '}
          {g.errors.slice(1).map((e, i) => (
            <span key={e.code}>
              {i > 0 ? ', ' : ''}
              <code>{e.code}</code> ({e.count})
            </span>
          ))}
        </p>
      )}
      <div className="conn-actions">
        <button type="button" className="btn" aria-expanded={lines !== null} aria-controls={id} onClick={() => void toggle()} data-usage-lines="">
          {lines === null ? 'Show recent failures' : 'Hide recent failures'}
        </button>
        <span className="runs">
          runs <code>toil audit list --command "{g.command}" --outcome failed --limit 10</code>
        </span>
      </div>
      <div id={id}>
        {lines === 'loading' && <p className="skin-loading">Reading the audit log…</p>}
        {lines !== null && lines !== 'loading' && !lines.ok && (
          <p role="alert" className="failure">
            <code>toil audit list</code> failed: {lines.message}
          </p>
        )}
        {lines !== null && lines !== 'loading' && lines.ok && (
          <DataTable
            label={`Recent failures of ${g.command}`}
            caption={`Recent failures of ${g.command}, newest first`}
            rows={lines.data}
            rowKey={(e) => `${e.time}:${e.via}:${e.outcome}`}
            columns={[
              { header: 'When', label: 'When', rowHeader: true, cell: (e) => dateTime(e.time) },
              { header: 'Error', label: 'Error', cell: (e) => <code>{e.outcome}</code> },
              { header: 'From', label: 'From', cell: (e) => doorLabel(e.via, e.caller) },
              { header: 'Connection', label: 'Connection', cell: (e) => (e.connection ? <code>{e.connection}</code> : 'none') },
              { header: 'Took', label: 'Took', cell: (e) => ms(e.durationMs) },
            ]}
          />
        )}
      </div>
    </Card>
  );
}

function Unused({ unused }: { unused: UnusedCommand[] }) {
  if (unused.length === 0) return <p>Every command toil has was called at least once in this window.</p>;
  const areas = unusedByArea(unused);
  const cliOnly = unused.filter((u) => !u.mcp).length;
  return (
    <>
      <p className="lede">
        {plural(unused.length, 'command')} had no call in this window, from <code>toil audit stats --unused</code>. A command no agent reaches for may need a clearer description or skill page.{' '}
        {cliOnly > 0 && <>{cliOnly === 1 ? 'One of them is' : `${cliOnly} of them are`} never served over MCP, so only a person on the CLI can run {cliOnly === 1 ? 'it' : 'them'}.</>}
      </p>
      <details className="more">
        <summary>Show them, by area</summary>
        <dl className="usage-unused">
          {areas.map((a) => (
            <div key={a.area}>
              <dt>{a.area === '' ? "toil's own" : a.area}</dt>
              <dd>
                <ul>
                  {a.commands.map((u) => (
                    <li key={u.command}>
                      <code>{u.command}</code>
                      {!u.mcp && <span className="runs"> (CLI only)</span>}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
