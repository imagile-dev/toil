import { createSqliteFile } from '../harness/db.js';
import { defineFixture } from '../harness/fixtures.js';

/**
 * The db area talks to a file, not an HTTP API, so it has no routes. Its
 * examples run against a seeded SQLite file made when the suite loads and
 * removed after it, through a connection with writes on so the execute
 * example runs. That example's UPDATE leaves the data as it found it, so the
 * CLI run and the MCP run see the same rows.
 */
const db = createSqliteFile();

export const fixture = defineFixture({
  area: 'db',
  routes: [],
  config: { db: { engine: 'sqlite', path: db.path, writes: true } },
  cleanup: db.cleanup,
});
