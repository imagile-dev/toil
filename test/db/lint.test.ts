import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute as executeCmd, lint, query } from '../../src/areas/db/index.js';
import type { AnyCommand } from '../../src/core/command.js';
import type { ResolvedConfig, Settings } from '../../src/core/config.js';
import { sqliteProvider } from '../../src/core/db/sqlite/index.js';
import { execute } from '../../src/core/run.js';
import { testConfig, testContext } from '../harness/context.js';
import { createSqliteFile, type TempSqlite } from '../harness/db.js';

/**
 * The pre-flight lint through execute(), on a real SQLite file: an error
 * refuses the SQL before the provider is asked anything, warnings arrive in
 * meta.warnings, and `db lint --engine` runs with no connection at all.
 * The rules themselves are in src/core/db/lint/lint.test.ts.
 */
let db: TempSqlite;
beforeEach(() => {
  db = createSqliteFile();
});
afterEach(() => {
  db.cleanup();
  vi.restoreAllMocks();
});

const run = (def: AnyCommand, input: Record<string, unknown>, settings: Settings = { engine: 'sqlite', path: db.path, writes: true }) => {
  const { context } = testContext({ config: { db: settings } });
  return execute(def, input, context);
};

const SQLITE_RULES = ['unterminated', 'multiple-statements', 'read-only-write', 'dialect-top', 'dialect-backtick', 'dialect-function', 'dialect-concat', 'select-star', 'implicit-cross-join'];

describe('db pre-flight lint before SQL runs', () => {
  it('refuses another dialect before the provider is asked, with the fix and meta.lint', async () => {
    const sent = vi.spyOn(sqliteProvider, 'query');
    const envelope = await run(query, { sql: 'SELECT TOP 2 name FROM people' });
    expect(sent).not.toHaveBeenCalled();
    expect(envelope.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'db query refused the SQL before sending it to SQLite: TOP is SQL Server syntax, not SQLite. [dialect-top, line 1, column 8]',
      fix: 'Drop TOP and put LIMIT 2 at the end of the statement. db query already caps the rows it returns with --limit.',
    });
    expect(envelope.meta.lint).toEqual({ engine: 'sqlite', rules: SQLITE_RULES });
  });

  it('refuses a write on a read as WRITE_DISABLED, and --no-lint does not let it through', async () => {
    const sent = vi.spyOn(sqliteProvider, 'query');
    for (const input of [{ sql: 'DELETE FROM people' }, { sql: 'DELETE FROM people', lint: false }]) {
      const envelope = await run(query, input);
      expect(envelope.error?.code).toBe('WRITE_DISABLED');
    }
    expect(sent).not.toHaveBeenCalled();
  });

  it('runs a statement with warnings, and lists them in meta.warnings', async () => {
    const envelope = await run(query, { sql: 'SELECT * FROM people ORDER BY id', limit: 1 });
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.warnings).toEqual([
      {
        code: 'LINT',
        message: 'SELECT * returns every column, and db query returns a page of at most --limit rows of them. [select-star, line 1, column 8] Fix: Name the columns you need; toil db table describe people lists them.',
      },
    ]);
  });

  it('skips the warnings, and only the warnings, with --no-lint', async () => {
    const envelope = await run(query, { sql: 'SELECT * FROM people ORDER BY id', limit: 1, lint: false });
    expect(envelope.ok).toBe(true);
    expect(envelope.meta.warnings).toBeUndefined();
    expect(envelope.meta.lint?.rules).toEqual(['unterminated', 'multiple-statements', 'read-only-write', 'dialect-top']);
  });

  it('lints db execute as a script: several statements and writes are fine, another dialect is not', async () => {
    const ok = await run(executeCmd, { sql: "UPDATE people SET name = name WHERE id = 1; UPDATE people SET name = name WHERE id = 2", allowWrite: true });
    expect(ok.ok).toBe(true);
    expect(ok.meta.lint?.rules).not.toContain('read-only-write');
    const sent = vi.spyOn(sqliteProvider, 'execute');
    const refused = await run(executeCmd, { sql: "UPDATE people SET name = 'it WHERE id = 1", allowWrite: true });
    expect(refused.error?.code).toBe('INVALID_INPUT');
    expect(refused.error?.message).toMatch(/\[unterminated, line 1, column 26\]/);
    expect(sent).not.toHaveBeenCalled();
  });
});

describe('db lint', () => {
  it('returns the findings as data, taking the engine from the connection', async () => {
    const envelope = await run(lint, { sql: 'SELECT * FROM people, teams' });
    expect(envelope.data).toMatchObject({ engine: 'sqlite', as: 'query', errors: 0, warnings: 2 });
    expect((envelope.data as { findings: Array<{ rule: string }> }).findings.map((f) => f.rule)).toEqual(['select-star', 'implicit-cross-join']);
    expect(envelope.meta.context?.connection).toMatchObject({ value: 'db' });
  });

  it('with --engine, uses no connection: none is chosen and no secret is read', async () => {
    const { context } = testContext();
    // Two connections and no default would be INVALID_INPUT for any call that picks one.
    const config: ResolvedConfig = testConfig({});
    config.connections['pg-a'] = { area: 'db', engine: 'postgres', host: 'pg.imagile.dev', database: 'a', user: 'u', password: 'keychain:pg-a' };
    config.connections['pg-b'] = { area: 'db', engine: 'postgres', host: 'pg.imagile.dev', database: 'b', user: 'u', password: 'keychain:pg-b' };
    const secrets = { get: vi.fn(async () => { throw new Error('no secret should be read'); }) };
    const envelope = await execute(lint, { sql: 'SELECT TOP 10 name FROM people', engine: 'postgres' }, { ...context, config, secrets: secrets as never });
    expect(envelope.ok).toBe(true);
    expect(envelope.data).toMatchObject({ engine: 'postgres', errors: 1, findings: [expect.objectContaining({ rule: 'dialect-top', severity: 'error' })] });
    expect(envelope.meta.context).toBeUndefined();
    expect(secrets.get).not.toHaveBeenCalled();
  });

  it('works with nothing set up when --engine is given, and says what to pass when it is not', async () => {
    const { context } = testContext();
    expect((await execute(lint, { sql: 'SELECT 1 FROM dual', engine: 'oracle' }, context)).ok).toBe(true);
    const missing = await execute(lint, { sql: 'SELECT 1' }, context);
    expect(missing.error).toMatchObject({ code: 'NOT_CONFIGURED', fix: 'Pass --engine (sqlite, postgres, mysql, sqlserver, oracle, teradata), or set up a db connection.' });
  });

  it('refuses an --engine that disagrees with the --connection named beside it', async () => {
    const envelope = await run(lint, { sql: 'SELECT 1', engine: 'postgres', connection: 'db' });
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: '--engine postgres disagrees with connection db, whose engine is sqlite.' });
  });

  it('checks as db execute would with --as execute', async () => {
    const envelope = await run(lint, { sql: 'DELETE FROM people; DELETE FROM teams', engine: 'mysql', as: 'execute' });
    expect(envelope.data).toMatchObject({ errors: 0, warnings: 0, findings: [] });
    expect(envelope.meta.lint).toEqual({ engine: 'mysql', rules: ['unterminated', 'dialect-top', 'dialect-function', 'dialect-concat', 'implicit-cross-join'] });
  });
});
