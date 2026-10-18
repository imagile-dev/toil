import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Deletes a test's database folder. On Windows a SQLite worker stopped mid-
 * statement (a time limit, a cancel) keeps the file open until that statement
 * returns, and a just-created file can be held for a moment too, so the delete
 * can fail with EPERM or EBUSY. That's not what any test checks: retry for about
 * two seconds (rmSync backs off 100 ms, 200 ms, … 600 ms), then leave the folder
 * in the OS temp directory rather than fail the test. Everything else throws.
 * The temp folder has seen worse.
 */
export function removeTestDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (process.platform === 'win32' && (code === 'EPERM' || code === 'EBUSY')) {
      console.warn(`Left ${dir} in the temp folder: Windows still holds it (${code}).`);
      return;
    }
    throw err;
  }
}

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
  'CREATE TABLE people (id INTEGER PRIMARY KEY, name VARCHAR(100) NOT NULL, team_id INTEGER, active INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (team_id) REFERENCES teams (id))',
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
  return { dir, path, cleanup: () => removeTestDir(dir) };
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
