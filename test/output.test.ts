import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../src/core/command.js';
import { summarize, estimateTokens } from '../src/core/output/summary.js';
import { success } from '../src/core/envelope.js';
import { shapeEnvelope } from '../src/core/output/shape.js';
import { allowWriteField, runCommand } from '../src/core/run.js';
import { waitCommand } from '../src/core/wait.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { connectMcp } from './harness/mcp.js';

/**
 * `--output-format` and `--summary-file` on their own terms: one fixture per
 * summary rule, the 5,000-row case the issue sets, and the edges (a file
 * already there, a read-only call, a write whose file can't be written).
 * test/parity.test.ts runs both through both front doors for every
 * registered command.
 */

/** `n` uniform rows, shaped like a search result's issues. */
const issues = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    key: `PAY-${i + 1}`,
    summary: `Issue number ${i + 1}`,
    points: (i % 8) + 1,
    created: `2026-0${(i % 9) + 1}-1${i % 10}T09:00:00Z`,
    fields: { status: { name: i % 3 === 0 ? 'Done' : 'Open' }, assignee: i % 5 === 0 ? null : `user${i % 7}` },
  }));

const returning = (data: unknown, extra: Partial<AnyCommand> = {}) =>
  defineCommand({ path: ['demo', 'result'], description: 'Return canned data', input: z.object({ ...allowWriteField }), writes: false, examples: [{}], run: async () => data, ...extra }) as AnyCommand;

const call = async (def: AnyCommand, input: Record<string, unknown>, options: { readOnly?: boolean; files?: Record<string, string> } = {}) => {
  const ctx = testContext(options.files ? { files: options.files } : {});
  const envelope = await runCommand(def, input, () => ctx.context, '0.0.0-test', 'mcp', undefined, options.readOnly ? { readOnly: true } : {});
  return { envelope, written: ctx.files.written };
};

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

describe('summary rules, first match wins', () => {
  it('record: a result with no table and 20 fields or fewer comes back whole', () => {
    const record = { id: 7, name: 'widget', tags: undefined };
    expect(summarize(record)).toMatchObject({ data: record, report: { rule: 'record', rows: 1, table: null } });
    expect(summarize('just text').report.rule).toBe('record');
  });

  it('all: 50 rows or fewer, under the token budget, come back whole', () => {
    const data = { total: 30, issues: issues(30) };
    expect(summarize(data)).toMatchObject({ data, report: { rule: 'all', rows: 30, table: 'issues' } });
  });

  it('head: up to 500 rows give the first 20, per-column stats and the fields beside the table', () => {
    const { data, report } = summarize({ total: 400, issues: issues(400) });
    const summary = data as { fields: unknown; rows: Array<{ key: string }>; stats: Record<string, unknown> };
    expect(report).toMatchObject({ rule: 'head', rows: 400, table: 'issues', columns: 6 });
    expect(summary.fields).toEqual({ total: 400 });
    expect(summary.rows.map((r) => r.key)).toEqual(Array.from({ length: 20 }, (_, i) => `PAY-${i + 1}`));
    expect(summary.stats).toEqual({
      key: { nulls: 0, distinct: 400, min: null, max: null },
      summary: { nulls: 0, distinct: 400, min: null, max: null },
      points: { nulls: 0, distinct: 8, min: 1, max: 8 },
      created: { nulls: 0, distinct: 90, min: '2026-01-10T09:00:00Z', max: '2026-09-19T09:00:00Z' },
      'fields.status.name': { nulls: 0, distinct: 2, min: null, max: null },
      'fields.assignee': { nulls: 80, distinct: 7, min: null, max: null },
    });
  });

  it('sample: more than 500 rows give the schema, 10 rows spread from first to last, and stats', () => {
    const { data, report, large } = summarize(issues(1000));
    const summary = data as { schema: Record<string, string>; rows: Array<{ key: string }> };
    expect(report).toMatchObject({ rule: 'sample', rows: 1000, table: '' });
    expect(large).toBe(true);
    expect(summary.schema).toEqual({ key: 'string', summary: 'string', points: 'number', created: 'date', 'fields.status.name': 'string', 'fields.assignee': 'string' });
    expect(summary.rows.map((r) => r.key)).toEqual(['PAY-1', 'PAY-112', 'PAY-223', 'PAY-334', 'PAY-445', 'PAY-556', 'PAY-667', 'PAY-778', 'PAY-889', 'PAY-1000']);
  });

  it('finds the table a level down, and keeps what is beside it while that is small', () => {
    const { data, report } = summarize({ format: 'sarif', findings: { total: 700, byLevel: { error: 700 }, results: issues(700) } });
    expect(report).toMatchObject({ rule: 'sample', rows: 700, table: 'findings.results' });
    expect((data as { fields: unknown }).fields).toEqual({ format: 'sarif', findings: { total: 700, byLevel: { error: 700 } } });
  });

  it('a nested table that flattens (80% of dot-path keys in every row) is treated as a table', () => {
    // Every row has a.b and c; one in ten also has d: 2 of 3 keys shared is under 80%, 4 of 5 is not.
    const rows = Array.from({ length: 100 }, (_, i) => ({ a: { b: i }, c: 'x', e: 1, f: 2, ...(i % 10 === 0 ? { d: true } : {}) }));
    expect(summarize(rows).report.rule).toBe('head');
    const sparse = Array.from({ length: 100 }, (_, i) => ({ a: { b: i }, c: 'x', ...(i % 10 === 0 ? { d: true } : {}) }));
    expect(summarize(sparse).report.rule).toBe('outline');
  });

  it("outline: data that doesn't flatten gives its top-level keys, list lengths and one sample", () => {
    const ragged = Array.from({ length: 80 }, (_, i) => ({ [`k${i}`]: i, common: 'y' }));
    const { data, report } = summarize({ name: 'scan', findings: ragged, byRule: { a: 1, b: 2 } });
    expect(report).toMatchObject({ rule: 'outline', rows: 80, table: 'findings' });
    expect(data).toEqual({ keys: ['name', 'findings', 'byRule'], lengths: { findings: 80, byRule: 2 }, sample: { k0: 0, common: 'y' } });
  });

  it('outline: a large object with no table is described rather than returned', () => {
    const wide = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`file${i}.ts`, { bytes: i * 100, lines: i }]));
    const { data, report } = summarize(wide);
    expect(report).toMatchObject({ rule: 'outline', rows: 1, table: null });
    expect((data as { keys: string[] }).keys).toHaveLength(300);
  });

  it('a 5,000-row result gives a summary under 1,500 estimated tokens', () => {
    const { data, report } = summarize({ issues: issues(5000) });
    expect(report.rule).toBe('sample');
    expect(estimateTokens(data)).toBeLessThan(1500);
    expect(report.tokens.full).toBeGreaterThan(100_000);
  });

  it('cuts long texts in rows short before dropping any, and says how many', () => {
    const wide = Array.from({ length: 300 }, (_, i) => ({ id: i, text: 'x'.repeat(400) }));
    const { data, report } = summarize(wide);
    expect(estimateTokens(data)).toBeLessThanOrEqual(1500);
    expect(report.trimmed).toEqual({ strings: 20 });
    expect((data as { rows: Array<{ text: string }> }).rows[0]!.text).toBe(`${'x'.repeat(200)}…`);
  });

  it('drops rows from the end, down to none, until wide rows fit the budget, and says how many', () => {
    const wide = Array.from({ length: 300 }, (_, i) => Object.fromEntries([['id', i], ...Array.from({ length: 30 }, (_, c) => [`c${c}`, 'y'.repeat(150)])]));
    const { data, report } = summarize(wide);
    expect(estimateTokens(data)).toBeLessThanOrEqual(1500);
    expect((data as { rows: unknown[] }).rows.length + report.trimmed!.rows!).toBe(20);
  });

  it('keeps a record too big for the budget out of data: a long text, alone or one or two levels down', () => {
    const big = 'x'.repeat(200_000);
    for (const value of [big, { path: 'build.log', content: big }, { a: { b: big } }]) {
      const { data, report } = summarize(value);
      expect(report.rule, JSON.stringify(data).slice(0, 80)).toBe('outline');
      expect(estimateTokens(data)).toBeLessThanOrEqual(1500);
      expect(report.trimmed?.strings).toBe(1);
    }
    expect(summarize(big).data).toEqual({ lengths: { '@': 200_000 }, sample: `${'x'.repeat(2000)}…` });
    expect(summarize({ path: 'build.log', content: big }).data).toEqual({ keys: ['path', 'content'], lengths: { content: 200_000 }, sample: { path: 'build.log', content: `${'x'.repeat(200)}…` } });
  });

  it('cuts a long text beside the table short, so head and sample keep their rows', () => {
    const big = 'x'.repeat(200_000);
    for (const n of [600, 100]) {
      const { data, report } = summarize({ log: big, items: issues(n) });
      expect(estimateTokens(data)).toBeLessThanOrEqual(1500);
      expect((data as { fields: { log: string } }).fields.log).toBe(`${'x'.repeat(200)}…`);
      expect(report.trimmed?.strings).toBeGreaterThanOrEqual(1);
      expect((data as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
    }
  });

  it('cuts an outline down to its keys when even they are over the budget', () => {
    const many = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`a-rather-long-file-name-${i}.ts`, { bytes: i }]));
    const { data, report } = summarize(many);
    expect(estimateTokens(data)).toBeLessThanOrEqual(1500);
    expect(report.trimmed).toMatchObject({ lengths: true, sample: true, keys: expect.any(Number) });
    expect((data as { keys: string[] }).keys[0]).toBe('a-rather-long-file-name-0.ts');
  });
});

describe('--summary-file and --output-format through runCommand', () => {
  it('writes the whole of data as JSON to the file and says so in meta.summary, and data, for a cut-down result', async () => {
    const data = { issues: issues(600) };
    const { envelope, written } = await call(returning(data), { summaryFile: 'out/search.json' });
    expect(envelope.ok).toBe(true);
    const [path] = Object.keys(written);
    expect(JSON.parse(text(written[path!]))).toEqual(data);
    expect(envelope.meta.summary).toMatchObject({ rule: 'sample', rows: 600, table: 'issues', file: expect.stringMatching(/out\/search\.json$/), tokens: { estimate: 'JSON characters / 3.5' } });
    expect((envelope.data as { file: string }).file).toBe(envelope.meta.summary!.file);
    expect(envelope.meta.warnings).toContainEqual(expect.objectContaining({ code: 'SUMMARY_LARGE', message: expect.stringContaining('Work over that file') }));
  });

  it('still writes the file when the whole result fits, so the path is always there', async () => {
    const { envelope, written } = await call(returning({ id: 1 }), { summaryFile: 'one.json' });
    expect(envelope.data).toEqual({ id: 1 });
    expect(envelope.meta.summary?.rule).toBe('record');
    expect(Object.keys(written)).toHaveLength(1);
  });

  it('renders data as TOON, after the summary, and leaves ok, error and the rest of meta as JSON', async () => {
    const { envelope } = await call(returning({ issues: [{ key: 'A-1', points: 3 }, { key: 'A-2', points: 5 }] }), { outputFormat: 'toon' });
    expect(envelope).toMatchObject({ ok: true, error: null, data: 'issues[2]{key,points}:\n  A-1,3\n  A-2,5', meta: { format: 'toon', command: 'demo result' } });
  });

  it('leaves the default output exactly as it was', async () => {
    const def = returning({ issues: issues(3) });
    const plain = await call(def, {});
    const asJson = await call(def, { outputFormat: 'json' });
    const strip = (e: typeof plain.envelope) => JSON.stringify({ ...e, meta: { ...e.meta, durationMs: 0 } });
    expect(strip(asJson.envelope)).toBe(strip(plain.envelope));
    expect(plain.envelope.meta).not.toHaveProperty('format');
    expect(plain.envelope.meta).not.toHaveProperty('summary');
  });

  it('refuses a bad format, an empty path and "-" before the command runs', async () => {
    let ran = 0;
    const def = returning(null, { run: async () => ++ran });
    for (const input of [{ outputFormat: 'yaml' }, { summaryFile: '' }, { summaryFile: '-' }, { summaryFile: 3 }]) {
      expect((await call(def, input)).envelope.error?.code, JSON.stringify(input)).toBe('INVALID_INPUT');
    }
    expect(ran).toBe(0);
  });

  it('refuses a file that already exists before the command runs, since toil never overwrites', async () => {
    let ran = 0;
    const { envelope } = await call(returning(null, { run: async () => ++ran }), { summaryFile: 'taken.json' }, { files: { 'taken.json': '{}' } });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('already exists') });
    expect(ran).toBe(0);
  });

  it('refuses summaryFile on a read-only call, since it writes a file', async () => {
    const { envelope, written } = await call(returning({ id: 1 }), { summaryFile: 'x.json' }, { readOnly: true });
    expect(envelope.error?.code).toBe('WRITE_DISABLED');
    expect(written).toEqual({});
  });

  it("says a write's change may be made when its result can't be written to the file, and a read's plainly", () => {
    const ok = success({ id: 1 }, { command: 'demo result', durationMs: 0, version: '0.0.0-test' });
    const files = { ...testContext().files, writeBytes: () => { throw new Error('disk full'); } };
    const written = shapeEnvelope(ok, { format: 'json', summaryFile: 'x.json' }, files, true);
    expect(written.error).toMatchObject({ message: expect.stringContaining('ran, and the change may already have been applied'), fix: expect.stringContaining('Check whether the change was made') });
    const read = shapeEnvelope(ok, { format: 'json', summaryFile: 'x.json' }, files, false);
    expect(read.error?.message).toBe("The result of demo result couldn't be written to the summary file: disk full");
  });
});

describe('both front doors', () => {
  it('carry --output-format and --summary-file as the same fields MCP sends', async () => {
    const def = returning({ issues: issues(120) });
    const cli = testContext();
    const viaCli = await runCli(['demo', 'result', '--output-format', 'toon', '--summary-file', 's.json'], { commands: [def], context: cli.context });
    const mcp = testContext();
    const session = await connectMcp({ commands: [def], context: mcp.context });
    try {
      const viaMcp = await session.call('demo_result', { outputFormat: 'toon', summaryFile: 's.json' });
      const same = (e: unknown) => ({ ...(e as { meta: object }), meta: { ...(e as { meta: object }).meta, durationMs: 0 } });
      expect(same(viaMcp.envelope)).toEqual(same(viaCli.envelope));
      expect(viaCli.envelope?.meta).toMatchObject({ format: 'toon', summary: { rule: 'head', rows: 120 } });
    } finally {
      await session.close();
    }
  });

  it('refuses the output flags inside toil wait --, where they belong before wait', async () => {
    const def = returning({ id: 1 });
    const { context } = testContext();
    const run = await runCli(['wait', '--until', 'id', '--', 'demo', 'result', '--output-format', 'toon'], { commands: [def, waitCommand], context });
    expect(run.envelope?.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining('--output-format goes before wait') });
  });
});
