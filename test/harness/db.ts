import { mkdtempSync, rmSync } from 'node:fs';

/**
 * How to delete a test's database folder. On Windows a worker that was just
 * stopped (a time limit, a cancel) can hold the SQLite file for a moment after
 * the test ends, and the delete fails with EPERM. Two seconds of retries
 * outlasts that; the file is not going anywhere, and neither are we.
 */
export const CLEANUP = { recursive: true, force: true, maxRetries: 20, retryDelay: 100 } as const;
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The seed every database test uses: two tables with a foreign key, an index,
 * a view, and enough rows to page through. Kept to SQL every engine accepts
 * (explicit ids, VARCHAR, INTEGER), so a server engine's conformance target
 * seeds the same data and the same assertions hold.
 *
 * The test data is fictional. Any resemblance to an actual org chart has been
 * reviewed and found to be the org chart's fault.
 */
export const PEOPLE = ['Ada', 'Grace', 'Edsger', 'Barbara', 'Donald', 'Frances', 'John', 'Margaret', 'Alan', 'Radia', 'Ken', 'Dennis'];

export const SEED_SQL: string[] = [
  'CREATE TABLE teams (id INTEGER PRIMARY KEY, name VARCHAR(50) NOT NULL UNIQUE)',
  'CREATE TABLE people (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, team_id INTEGER REFERENCES teams (id), active INTEGER NOT NULL DEFAULT 1)',
  'CREATE INDEX people_team ON people (team_id)',
  'CREATE VIEW active_people AS SELECT id, name FROM people WHERE active = 1',
  "INSERT INTO teams (id, name) VALUES (1, 'Platform'), (2, 'Data')",
  `INSERT INTO people (id, name, team_id, active) VALUES ${PEOPLE.map((name, i) => `(${i + 1}, '${name}', ${(i % 2) + 1}, ${i % 3 === 2 ? 0 : 1})`).join(', ')}`,
];

export interface TempSqlite {
  dir: string;
  path: string;
  /** Removes the folder. Retries, because Windows holds a file a moment after its last handle closes. */
  cleanup: () => void;
}

/** A seeded SQLite file in a fresh temp folder. */
export function createSqliteFile(seed: string[] = SEED_SQL): TempSqlite {
  const dir = mkdtempSync(join(tmpdir(), 'toil-db-'));
  const path = join(dir, 'test.db');
  const db = new DatabaseSync(path);
  try {
    for (const sql of seed) db.exec(sql);
  } finally {
    db.close();
  }
  return { dir, path, cleanup: () => rmSync(dir, CLEANUP) };
}

/** Runs SQL against a SQLite file directly, outside toil, to check what a command did. */
export function sqliteRows(path: string, sql: string): unknown[] {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
}
