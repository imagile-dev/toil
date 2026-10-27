import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brief, standardSettings } from '../src/core/brief/brief.js';
import { readBriefRecords } from '../src/core/brief/read.js';
import type { Envelope } from '../src/core/envelope.js';
import { drawsHyperlinks } from '../src/welcome/term.js';
import type { Action, Run, StepResult } from '../src/welcome/view.js';
import { briefingLines, briefRun, link, readSteps } from '../src/welcome/views/briefing.js';
import { shownArgs } from '../src/welcome/views/result.js';

/**
 * The welcome menu's Briefing (#494): the reads it composes from what the
 * dossier names, the runs that follow (each open pull request in full, then
 * util owi map, then dossiers brief), and the screen, with keys as terminal
 * hyperlinks where the terminal draws them and the URL printed where not.
 */

const env = (command: string, data: unknown, connection?: string): Envelope => ({ ok: true, data, error: null, meta: { command, durationMs: 0, version: 'x', contractVersion: 1, ...(connection ? { context: { connection: { value: connection, source: 'default' } } } : {}) } }) as Envelope;
const result = (args: string[], envelope: Envelope): StepResult => ({ args, envelope });
const runOf = (a: Action | undefined): Run => {
  if (!a || !('run' in a)) throw new Error(`expected a run, got ${JSON.stringify(a)}`);
  return a.run;
};

describe('the reads', () => {
  it("reads each tracker's issues and each code host's open pull requests, as the dossier names them", () => {
    const { steps, skipped } = readSteps('payments', {
      jira: { inputs: { project: 'PAY' } },
      github: { inputs: { owner: 'imagile', repo: 'payments-web' } },
      bitbucket: { inputs: { project: 'PAY', repo: 'payments-core' } },
      ado: { inputs: { project: 'Payments' } },
    });
    expect(steps.map((s) => s.args.join(' '))).toEqual([
      'jira issue search --dossier payments --jql project = PAY ORDER BY Rank ASC',
      'github issue list --dossier payments --state all',
      'github pr list --dossier payments --state open',
      'bitbucket pr list --dossier payments --state OPEN',
    ]);
    // Azure DevOps work items need a query and a read each; the menu says it leaves them to Toil UI.
    expect(skipped).toEqual(['ado']);
  });

  it('then reads each open pull request in full, maps everything with key patterns from the issues, and briefs it', () => {
    const run = briefRun('payments', { jira: { inputs: { project: 'PAY' } }, bitbucket: { inputs: { project: 'PAY', repo: 'payments-core' } } });
    const read = [
      result(run.steps[0]!.args, env('jira issue search', { issues: [{ key: 'PAY-101' }, { key: 'PAY-102' }] }, 'corp-jira')),
      result(run.steps[1]!.args, env('bitbucket pr list', [{ id: 311 }, { id: 305 }])),
    ];
    const gets = runOf(run.next!(read, {} as never));
    expect(gets.steps.map((s) => s.args.join(' '))).toEqual(['bitbucket pr get 311 --dossier payments --include reviews,checks', 'bitbucket pr get 305 --dossier payments --include reviews,checks']);
    const map = runOf(gets.next!([result(gets.steps[0]!.args, env('bitbucket pr get', { id: 311 }))], {} as never));
    const mapArgs = map.steps[0]!.args;
    expect(mapArgs.slice(0, 3)).toEqual(['util', 'owi', 'map']);
    expect(mapArgs.slice(-2)).toEqual(['--key-pattern', 'PAY-{n}=corp-jira']);
    expect(mapArgs[4]!.split('\n')).toHaveLength(3);
    const briefed = runOf(map.next!([result(mapArgs, env('util owi map', { items: [] }))], {} as never));
    expect(briefed.steps[0]!.args.slice(0, 3)).toEqual(['dossiers', 'brief', 'payments']);
    expect(briefed.next!([result(briefed.steps[0]!.args, env('dossiers brief', {}))], {} as never)).toEqual({ go: 'dossier-brief', params: { dossier: 'payments' } });
  });

  it('names a long --text on the result screen rather than printing it', () => {
    expect(shownArgs(['util', 'owi', 'map', '--text', `${'x'.repeat(200)}\n${'y'.repeat(10)}`])).toEqual(['util', 'owi', 'map', '--text', '<2 results from the steps above>']);
    expect(shownArgs(['dossiers', 'brief', 'p', '--text', 'short'])).toEqual(['dossiers', 'brief', 'p', '--text', 'short']);
  });
});

describe('the briefing screen', () => {
  const records = readBriefRecords(`${readFileSync('test/fixtures/owi/sprint-42.owi.json', 'utf8')}${readFileSync('test/fixtures/owi/pull-requests.owi.json', 'utf8')}`);
  const b = brief({ items: records.items, changes: records.changes, asOf: '2026-10-14T08:00:00Z', settings: standardSettings(2) });

  it('links each key to its ticket where the terminal draws hyperlinks', () => {
    const text = briefingLines({ colorDepth: 1, unicode: true, hyperlinks: true }, b).join('\n');
    expect(text).toContain('Fix the failing checks on \x1b]8;;https://jira.imagile.dev/browse/PAY-101\x1b\\PAY-101\x1b]8;;\x1b\\ first');
    expect(text).not.toContain('    https://jira.imagile.dev/browse/PAY-101');
  });

  it('prints the URL under each item where it does not', () => {
    const text = briefingLines({ colorDepth: 1, unicode: false, hyperlinks: false }, b).join('\n');
    expect(text).toContain('Fix the failing checks on PAY-101 first');
    expect(text).toContain('    https://jira.imagile.dev/browse/PAY-101');
    expect(text).not.toContain('\x1b]8;;');
    expect(text).toContain('On track: 3 open, 13 done.');
  });

  it('draws a link only with a URL', () => {
    expect(link({ colorDepth: 1, unicode: true, hyperlinks: true }, 'PAY-1', null)).toBe('PAY-1');
  });
});

it('knows which terminals draw hyperlinks, and never claims an unknown one does', () => {
  expect(drawsHyperlinks({ WT_SESSION: 'abc' })).toBe(true);
  expect(drawsHyperlinks({ TERM_PROGRAM: 'vscode' })).toBe(true);
  expect(drawsHyperlinks({ VTE_VERSION: '7200' })).toBe(true);
  expect(drawsHyperlinks({ VTE_VERSION: '4800' })).toBe(false);
  expect(drawsHyperlinks({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false);
  expect(drawsHyperlinks({ WT_SESSION: 'abc', TERM: 'dumb' })).toBe(false);
});
