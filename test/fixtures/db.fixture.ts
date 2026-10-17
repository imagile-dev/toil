import { sqliteProvider } from '../../src/core/db/sqlite/index.js';
import { createSqliteFile, type TempSqlite } from '../harness/db.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * The db area talks to a file, not an HTTP API, so it has no routes. Its
 * examples run against a seeded SQLite file that setup makes and teardown
 * removes, through a connection with writes on so the execute example runs.
 * That example's UPDATE leaves the data as it found it, so the CLI run and the
 * MCP run see the same rows.
 *
 * With no requests to compare, the parity suite compares the provider calls
 * instead: the SQLite provider is traced, so both front doors must ask it the
 * same thing with the same arguments, and a read must never reach `execute`.
 */
let db: TempSqlite | undefined;

export const fixture = defineFixture({
  area: 'db',
  trace: [{ label: 'sqlite', target: sqliteProvider, writes: ['execute'] }],
  setup: () => {
    db = createSqliteFile();
    return { config: { db: { engine: 'sqlite', path: db.path, writes: true } } };
  },
  teardown: () => db?.cleanup(),
});
