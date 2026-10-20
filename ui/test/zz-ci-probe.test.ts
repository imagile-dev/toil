// @vitest-environment node
// TEMPORARY CI probe for #328, dropped before review.
import { mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, cpus, tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'vitest';
import { loadSqlite } from '../server/sqlite.ts';

it('probe: sqlite commit cost by journal mode', async () => {
  const { DatabaseSync } = await loadSqlite();
  const lines = [`PROBE env ${process.platform} node ${process.version} parallelism ${availableParallelism()} cpu ${cpus()[0]?.model} tmp ${tmpdir()} runnerTemp ${process.env.RUNNER_TEMP ?? '-'}`];
  const modes: Array<[string, string]> = [
    ['default (DELETE, FULL)', ''],
    ['DELETE, NORMAL', 'PRAGMA synchronous = NORMAL;'],
    ['TRUNCATE, FULL', 'PRAGMA journal_mode = TRUNCATE;'],
    ['PERSIST, FULL', 'PRAGMA journal_mode = PERSIST;'],
    ['WAL, FULL', 'PRAGMA journal_mode = WAL;'],
    ['WAL, NORMAL', 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;'],
  ];
  for (const base of [tmpdir(), ...(process.env.RUNNER_TEMP ? [process.env.RUNNER_TEMP] : [])]) {
    for (const [name, pragma] of modes) {
      const dir = mkdtempSync(join(base, 'probe-'));
      const db = new DatabaseSync(join(dir, 'p.db'));
      if (pragma) db.exec(pragma);
      db.exec('CREATE TABLE t (a INTEGER, b TEXT)');
      const ins = db.prepare('INSERT INTO t VALUES (?, ?)');
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) {
        db.exec('BEGIN');
        for (let j = 0; j < 20; j++) ins.run(i * 20 + j, 'x'.repeat(200));
        db.exec('COMMIT');
      }
      const ms = performance.now() - t0;
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      lines.push(`PROBE sqlite ${base === tmpdir() ? 'tmpdir' : 'RUNNER_TEMP'} ${name}: 40 commits ${ms.toFixed(0)} ms (${(ms / 40).toFixed(1)} ms/commit)`);
    }
  }
  console.info(lines.join('\n'));
}, 120_000);
