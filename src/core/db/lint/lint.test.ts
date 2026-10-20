import { describe, expect, it } from 'vitest';
import { engineNames } from '../engines.js';
import { LABELS, lintError, lintSql, type Dialect, type LintPurpose, type RuleId } from './index.js';
import { tokenize } from './tokens.js';

const ENGINES: Dialect[] = ['sqlite', 'postgres', 'mysql', 'sqlserver', 'oracle'];

interface Case {
  sql: string;
  as?: LintPurpose;
}

/**
 * For every engine, every rule that runs on it: SQL that trips it and SQL
 * that doesn't. A rule that runs on an engine without a row here fails the
 * coverage test below, so a new rule can't ship without its fixtures.
 */
const FIXTURES: Record<Dialect, Partial<Record<RuleId, { bad: Case; good: Case }>>> = {
  sqlite: {
    unterminated: { bad: { sql: "SELECT 'Ada FROM people" }, good: { sql: "SELECT 'it''s' FROM people /* runs to the end in SQLite" } },
    'multiple-statements': { bad: { sql: 'SELECT 1; SELECT 2' }, good: { sql: 'SELECT 1;' } },
    'read-only-write': { bad: { sql: "UPDATE people SET name = 'x'" }, good: { sql: 'SELECT name FROM people FOR UPDATE' } },
    'dialect-top': { bad: { sql: 'SELECT TOP 5 name FROM people' }, good: { sql: 'SELECT top FROM people LIMIT 5' } },
    'dialect-backtick': { bad: { sql: 'SELECT `name` FROM people' }, good: { sql: 'SELECT "name", [id] FROM people' } },
    'dialect-function': { bad: { sql: 'SELECT NOW()' }, good: { sql: "SELECT datetime('now'), IFNULL(name, 'x') FROM people" } },
    'dialect-concat': { bad: { sql: "SELECT name + ' Lovelace' FROM people" }, good: { sql: "SELECT name || ' Lovelace', '1' + 1 FROM people" } },
    'select-star': { bad: { sql: 'SELECT * FROM people' }, good: { sql: 'SELECT COUNT(*) FROM people WHERE EXISTS (SELECT * FROM teams)' } },
    'implicit-cross-join': { bad: { sql: 'SELECT p.name FROM people p, teams t' }, good: { sql: 'SELECT p.name FROM people p, teams t WHERE p.team = t.id' } },
  },
  postgres: {
    unterminated: { bad: { sql: 'SELECT $$never closed' }, good: { sql: "SELECT $body$ it's ; $body$, E'\\'', /* a /* nested */ comment */ 1" } },
    'multiple-statements': { bad: { sql: 'SELECT 1; SELECT 2;' }, good: { sql: "SELECT ';' AS semicolon" } },
    'read-only-write': { bad: { sql: 'WITH gone AS (DELETE FROM people RETURNING id) SELECT id FROM gone' }, good: { sql: "WITH x AS (SELECT 'DELETE' AS word) SELECT word FROM x" } },
    'dialect-top': { bad: { sql: 'SELECT DISTINCT TOP (10) name FROM people' }, good: { sql: 'SELECT name FROM people LIMIT 10' } },
    'dialect-backtick': { bad: { sql: 'SELECT `name` FROM people' }, good: { sql: 'SELECT "name" FROM people' } },
    'dialect-function': { bad: { sql: 'SELECT GETDATE(), ISNULL(name, 1) FROM people' }, good: { sql: 'SELECT now(), COALESCE(name, 1), length(name) FROM people' } },
    'dialect-concat': { bad: { sql: "SELECT 'Ada' + name FROM people" }, good: { sql: "SELECT now() + '1 day'::interval, DATE '2026-01-02' + 1" } },
    'select-star': { bad: { sql: 'SELECT DISTINCT * FROM public.people' }, good: { sql: 'SELECT p.* FROM people p' } },
    'implicit-cross-join': { bad: { sql: 'SELECT 1 FROM people, teams' }, good: { sql: "SELECT extract(year FROM now()), substring(name FROM 1 FOR 2) FROM people CROSS JOIN teams" } },
  },
  mysql: {
    unterminated: { bad: { sql: 'SELECT "Ada FROM people' }, good: { sql: "SELECT 'it\\'s', \"quoted\" FROM people # a comment" } },
    'multiple-statements': { bad: { sql: 'SELECT 1; DROP TABLE people' }, good: { sql: 'SELECT 1 -- ; not a cut' } },
    'read-only-write': { bad: { sql: "REPLACE INTO people (id, name) VALUES (1, 'Ada')" }, good: { sql: "SELECT REPLACE(name, 'a', 'b') FROM people" } },
    'dialect-top': { bad: { sql: 'SELECT TOP 3 name FROM people' }, good: { sql: 'SELECT name FROM people LIMIT 3' } },
    'dialect-function': { bad: { sql: 'SELECT GETDATE()' }, good: { sql: 'SELECT NOW(), IFNULL(name, 1), ISNULL(name) FROM people' } },
    'dialect-concat': { bad: { sql: "SELECT name || ' Lovelace' FROM people" }, good: { sql: "SELECT CONCAT(name, ' Lovelace'), `id` FROM people" } },
    'select-star': { bad: { sql: 'SELECT * FROM `people`' }, good: { sql: 'SELECT id, name FROM people' } },
    'implicit-cross-join': { bad: { sql: 'SELECT 1 FROM people, teams ORDER BY 1' }, good: { sql: 'SELECT 1 FROM people JOIN teams ON people.team = teams.id' } },
  },
  sqlserver: {
    unterminated: { bad: { sql: 'SELECT [name FROM people' }, good: { sql: "SELECT [a]]b], N'it''s' /* a /* nested */ comment */" } },
    'multiple-statements': { bad: { sql: 'SELECT 1; SELECT 2' }, good: { sql: 'BEGIN TRY SELECT 1; END TRY BEGIN CATCH SELECT 2; END CATCH' } },
    'read-only-write': { bad: { sql: 'TRUNCATE TABLE people' }, good: { sql: 'SELECT TOP (5) name FROM people' } },
    'dialect-limit': { bad: { sql: 'SELECT name FROM people ORDER BY name LIMIT 10' }, good: { sql: 'SELECT [limit] FROM people ORDER BY name OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY' } },
    'dialect-backtick': { bad: { sql: 'SELECT `name` FROM people' }, good: { sql: 'SELECT [name], "id" FROM people' } },
    'dialect-function': { bad: { sql: 'SELECT NOW(), LENGTH(name) FROM people' }, good: { sql: 'SELECT GETDATE(), LEN(name), ISNULL(name, 1) FROM people' } },
    'dialect-concat': { bad: { sql: "SELECT name || ' Lovelace' FROM people" }, good: { sql: "SELECT name + ' Lovelace' FROM people" } },
    'select-star': { bad: { sql: 'SELECT TOP 10 * FROM people' }, good: { sql: 'SELECT TOP 10 id FROM people' } },
    'implicit-cross-join': { bad: { sql: 'SELECT 1 FROM people, teams' }, good: { sql: 'SELECT 1 FROM people, teams WHERE people.team = teams.id' } },
  },
  oracle: {
    unterminated: { bad: { sql: "SELECT q'[never closed' FROM dual" }, good: { sql: "SELECT q'[it's]', N'x' FROM dual" } },
    'multiple-statements': { bad: { sql: 'SELECT 1 FROM dual; SELECT 2 FROM dual' }, good: { sql: 'BEGIN NULL; NULL; END;' } },
    'read-only-write': { bad: { sql: 'CREATE TABLE t (id NUMBER)' }, good: { sql: 'SELECT id FROM people' } },
    'dialect-limit': { bad: { sql: 'SELECT name FROM people LIMIT :n' }, good: { sql: 'SELECT name FROM people FETCH FIRST 10 ROWS ONLY' } },
    'dialect-top': { bad: { sql: 'SELECT TOP 10 name FROM people' }, good: { sql: 'SELECT top FROM people' } },
    'dialect-backtick': { bad: { sql: 'SELECT `name` FROM people' }, good: { sql: 'SELECT "NAME" FROM people' } },
    'dialect-function': { bad: { sql: 'SELECT IFNULL(name, 1), NOW() FROM people' }, good: { sql: 'SELECT NVL(name, 1), SYSTIMESTAMP, LENGTH(name) FROM people' } },
    'dialect-concat': { bad: { sql: "SELECT 'Ada' + name FROM people" }, good: { sql: "SELECT 'Ada' || name FROM people" } },
    'select-star': { bad: { sql: 'SELECT * FROM people' }, good: { sql: 'SELECT name FROM people' } },
    'implicit-cross-join': { bad: { sql: 'SELECT 1 FROM people, teams UNION SELECT 1 FROM dual' }, good: { sql: 'SELECT 1 FROM people, teams WHERE people.team = teams.id UNION SELECT 1 FROM dual' } },
  },
};

const rulesOf = (sql: string, engine: Dialect, as: LintPurpose = 'query') => lintSql(sql, engine, { purpose: as }).findings.map((f) => f.rule);

describe('db pre-flight lint', () => {
  it('knows every engine toil ships', () => {
    expect([...engineNames].sort()).toEqual([...ENGINES].sort());
    for (const engine of engineNames) expect(LABELS[engine as Dialect]).toBeTruthy();
  });

  for (const engine of ENGINES) {
    describe(engine, () => {
      it('has fixtures for every rule that runs on it', () => {
        const ran = new Set([...lintSql('SELECT 1', engine, { purpose: 'query' }).rules, ...lintSql('SELECT 1', engine, { purpose: 'execute' }).rules]);
        expect(Object.keys(FIXTURES[engine]).sort()).toEqual([...ran].sort());
      });

      for (const [rule, { bad, good }] of Object.entries(FIXTURES[engine])) {
        it(`${rule}: trips on bad SQL, and stays quiet on good SQL`, () => {
          expect(rulesOf(bad.sql, engine, bad.as)).toContain(rule);
          expect(rulesOf(good.sql, engine, good.as)).toEqual([]);
        });
      }

      it('reports a clean statement as clean', () => {
        expect(rulesOf('SELECT id, name FROM people WHERE id = 1 ORDER BY id', engine)).toEqual([]);
      });
    });
  }

  it('gives every finding its position and a fix', () => {
    const [finding] = lintSql('SELECT id\n  FROM people LIMIT 10', 'sqlserver', { purpose: 'query' }).findings;
    expect(finding).toEqual({
      rule: 'dialect-limit',
      severity: 'error',
      message: "LIMIT isn't SQL Server syntax; it's how PostgreSQL, MySQL and SQLite cap rows.",
      fix: 'Write SELECT TOP (10) ..., or ORDER BY ... OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY. db query already caps the rows it returns with --limit.',
      position: { offset: 24, line: 2, column: 15 },
    });
  });

  it('names the dialect\'s own form in the fix', () => {
    const fix = (sql: string, engine: Dialect) => lintSql(sql, engine, { purpose: 'query' }).findings[0]?.fix;
    expect(fix('SELECT TOP 5 id FROM t', 'postgres')).toMatch(/LIMIT 5/);
    expect(fix('SELECT TOP 5 id FROM t', 'oracle')).toMatch(/FETCH FIRST 5 ROWS ONLY/);
    expect(fix('SELECT id FROM t LIMIT 5', 'oracle')).toMatch(/FETCH FIRST 5 ROWS ONLY.*ROWNUM <= 5/);
    expect(fix('SELECT `id` FROM t', 'sqlserver')).toMatch(/\[name\]/);
    expect(fix('SELECT GETDATE()', 'postgres')).toMatch(/now\(\)/);
    expect(fix("SELECT 'a' || 'b'", 'mysql')).toMatch(/CONCAT/);
  });

  it('treats a write as a read-only error only on a query, and a script as many statements only on execute', () => {
    expect(rulesOf("UPDATE people SET name = 'x'; DELETE FROM teams", 'postgres', 'execute')).toEqual([]);
    expect(rulesOf("UPDATE people SET name = 'x'; DELETE FROM teams", 'postgres')).toEqual(['multiple-statements', 'read-only-write', 'read-only-write']);
    expect(lintSql('SELECT * FROM people', 'postgres', { purpose: 'execute' }).rules).not.toContain('select-star');
  });

  it('skips the warning rules on request, never an error', () => {
    const result = lintSql('SELECT * FROM people, teams LIMIT 5', 'sqlserver', { purpose: 'query', warnings: false });
    expect(result.rules).toEqual(['unterminated', 'multiple-statements', 'read-only-write', 'dialect-limit', 'dialect-backtick']);
    expect(result.findings.map((f) => f.rule)).toEqual(['dialect-limit']);
  });

  it("warns on SQLite's backticks, which it accepts, rather than refusing them", () => {
    expect(lintSql('SELECT `id` FROM t', 'sqlite', { purpose: 'query' }).findings[0]?.severity).toBe('warning');
    expect(lintSql('SELECT `id` FROM t', 'postgres', { purpose: 'query' }).findings[0]?.severity).toBe('error');
  });

  it('turns errors into one ToilError, WRITE_DISABLED for a write on a read', () => {
    expect(lintError(lintSql('SELECT id FROM t', 'postgres', { purpose: 'query' }), 'db query')).toBeUndefined();
    const write = lintError(lintSql('DROP TABLE t', 'postgres', { purpose: 'query' }), 'db query')!;
    expect(write.code).toBe('WRITE_DISABLED');
    expect(write.message).toBe('db query refused the SQL before sending it to PostgreSQL: DROP changes the database, and db query runs read-only. [read-only-write, line 1, column 1]');
    expect(write.fix).toMatch(/toil db execute --allow-write/);
    const dialect = lintError(lintSql('SELECT TOP 1 id FROM t', 'mysql', { purpose: 'query' }), 'db query')!;
    expect(dialect.code).toBe('INVALID_INPUT');
    expect(dialect.details).toEqual({ lint: [expect.objectContaining({ rule: 'dialect-top' })] });
  });

  it("accepts a MySQL string either sql_mode closes, since the lint can't see which one the server runs", () => {
    expect(rulesOf(String.raw`SELECT 'C:\' AS path`, 'mysql')).toEqual([]);
    expect(rulesOf(String.raw`SELECT 'C:\' AS path`, 'postgres')).toEqual([]);
    expect(rulesOf(String.raw`SELECT 'it\'s' AS word`, 'mysql')).toEqual([]);
    expect(rulesOf("SELECT 'Ada AS name", 'mysql')).toEqual(['unterminated']);
  });

  it('reports an unterminated quote alone, at its opener', () => {
    const result = lintSql("SELECT TOP 1 * FROM t WHERE name = 'Ada", 'postgres', { purpose: 'query' });
    expect(result.findings).toEqual([
      expect.objectContaining({ rule: 'unterminated', position: { offset: 35, line: 1, column: 36 }, fix: "Close it with ', and write a quote inside the string as ''." }),
    ]);
  });
});

describe('lint tokenizer', () => {
  it("keeps each engine's quoting rules", () => {
    const kinds = (sql: string, engine: Dialect) => tokenize(sql, engine).tokens.map((t) => `${t.kind}:${t.text}`);
    expect(kinds('"a" `b`', 'mysql')).toEqual(['string:"a"', 'ident:`b`']);
    expect(kinds('"a" [b]', 'sqlserver')).toEqual(['ident:"a"', 'ident:[b]']);
    expect(kinds("E'\\'' $1 x::int", 'postgres')).toEqual(["string:E'\\''", 'param:$1', 'word:x', 'op:::', 'word:int']);
    expect(kinds("nq'{a}' :id", 'oracle')).toEqual(["string:nq'{a}'", 'param::id']);
    expect(kinds('@x @@rowcount', 'sqlserver')).toEqual(['param:@x', 'param:@@rowcount']);
    expect(kinds('--x\n1 -- y', 'mysql')).toEqual(['op:-', 'op:-', 'word:x', 'number:1']);
  });
});
