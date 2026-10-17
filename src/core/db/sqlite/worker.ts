import { Worker } from 'node:worker_threads';
import type { RowWindow } from '../provider.js';

/**
 * node:sqlite is synchronous: a query run on the main thread blocks the event
 * loop, so neither the timeout nor Ctrl+C nor an MCP cancel could fire until it
 * finished. Each job therefore runs on a worker thread (a thread, not a
 * process: nothing is spawned), and the main thread stays free to give up on
 * it. On abort the worker is terminated, which stops the statement at the next
 * row it hands back to JavaScript.
 *
 * It also keeps `node:sqlite` out of the main bundle's imports. Loading it
 * prints an experimental-feature warning, and the worker's stderr is captured
 * rather than inherited, so that notice goes to --debug instead of every
 * caller's terminal. Warnings have been routed to the appropriate inbox,
 * which is read with the usual diligence.
 */

/** One statement for the worker to run. */
export interface SqliteStep {
  sql: string;
  params?: Array<string | number | null>;
  /** `rows` prepares one statement and reads a window of its rows; `exec` runs a script of statements. */
  mode: 'rows' | 'exec';
  /** For `rows`: skip and cap. Absent means every row. */
  window?: RowWindow;
  /** For `rows`: refuse SQL with more than one statement instead of quietly running only the first. */
  single?: boolean;
  /** For `rows`: if this step returns no rows, stop and skip the steps after it. */
  stopIfEmpty?: boolean;
}

export interface SqliteJob {
  path: string;
  /** False opens the file read-only and sets `PRAGMA query_only`, so the engine refuses every write. */
  write: boolean;
  /** How long SQLite waits on another process's lock before giving up. */
  busyTimeoutMs: number;
  steps: SqliteStep[];
}

export type SqliteStepResult =
  | { mode: 'rows'; columns: Array<{ name: string; type: string | null }>; rows: unknown[][] }
  | { mode: 'exec'; changes: number };

/** What the worker reports when a statement fails. `kind` marks failures toil detected rather than SQLite. */
export interface SqliteFailure {
  message: string;
  code?: string;
  errcode?: number;
  kind?: 'multiple' | 'empty' | 'transaction';
}

type WorkerReply = { ok: true; results: SqliteStepResult[] } | { ok: false; error: SqliteFailure };

/**
 * The worker's whole program. It runs from its own source text in a fresh
 * thread, so it must not reference anything outside its body: no imports, no
 * helpers, no closures. Node built-ins come from process.getBuiltinModule,
 * which a bundler leaves alone.
 */
function sqliteWorkerMain(): void {
  const { parentPort, workerData } = process.getBuiltinModule('node:worker_threads');
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
  const job = workerData as SqliteJob;
  const reply = (message: WorkerReply) => parentPort!.postMessage(message);

  // Whitespace, semicolons and comments: what may follow the one statement a query runs.
  const trailing = /^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?(?:\*\/|$))*$/;
  // A statement that begins, ends or nests a transaction, after any leading comments.
  const transactionControl = /^(?:\s|;|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*(?:BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
  let db: InstanceType<typeof DatabaseSync> | undefined;
  try {
    db = new DatabaseSync(job.path, { readOnly: !job.write, timeout: job.busyTimeoutMs });
    if (!job.write) db.exec('PRAGMA query_only = ON');
    const results: SqliteStepResult[] = [];
    for (const step of job.steps) {
      if (step.mode === 'exec') {
        const total = () => Number((db!.prepare('SELECT total_changes() AS n').get() as { n: number | bigint }).n);
        const before = total();
        db.exec('BEGIN');
        try {
          // One statement at a time, so a script's own COMMIT or ROLLBACK is
          // refused before it runs. Run blind, it would end our transaction
          // and leave the statements before it applied however the rest went.
          let rest = step.sql;
          while (!trailing.test(rest)) {
            const stmt = db.prepare(rest);
            const source = stmt.sourceSQL;
            if (transactionControl.test(source)) {
              throw Object.assign(new Error('The script controls its own transaction.'), { kind: 'transaction' });
            }
            stmt.run();
            // sourceSQL is a prefix of what was prepared; if it ever isn't, stop rather than loop.
            if (!source || !rest.startsWith(source)) break;
            rest = rest.slice(source.length);
          }
          db.exec('COMMIT');
        } catch (err) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw err;
        }
        results.push({ mode: 'exec', changes: total() - before });
        continue;
      }

      const stmt = db.prepare(step.sql);
      let source: string;
      try {
        source = stmt.sourceSQL;
      } catch {
        // SQL that is only comments or semicolons prepares to nothing at all.
        reply({ ok: false, error: { message: 'The SQL holds no statement.', kind: 'empty' } });
        return;
      }
      if (step.single && step.sql.startsWith(source) && !trailing.test(step.sql.slice(source.length))) {
        reply({ ok: false, error: { message: 'The SQL holds more than one statement.', kind: 'multiple' } });
        return;
      }
      stmt.setReadBigInts(true);
      stmt.setReturnArrays(true);
      const columns = stmt.columns().map((c) => ({ name: c.name, type: c.type ?? null }));
      const rows: unknown[][] = [];
      const skip = step.window?.offset ?? 0;
      const max = step.window?.max ?? Infinity;
      let seen = 0;
      if (max > 0) {
        for (const row of stmt.iterate(...(step.params ?? []))) {
          if (seen++ < skip) continue;
          rows.push(row as unknown as unknown[]);
          if (rows.length >= max) break;
        }
      }
      results.push({ mode: 'rows', columns, rows });
      if (step.stopIfEmpty && rows.length === 0) break;
    }
    reply({ ok: true, results });
  } catch (err) {
    const e = err as { message?: string; code?: string; errcode?: number; kind?: SqliteFailure['kind'] };
    reply({
      ok: false,
      error: {
        message: String(e.message ?? err),
        ...(e.code ? { code: e.code } : {}),
        ...(typeof e.errcode === 'number' ? { errcode: e.errcode } : {}),
        ...(e.kind ? { kind: e.kind } : {}),
      },
    });
  } finally {
    try {
      db?.close();
    } catch {
      // Already closed, or never opened.
    }
  }
}

const SOURCE = `(${sqliteWorkerMain.toString()})()`;

/** A statement failed inside the worker; the provider maps it to a ToilError. */
export class SqliteWorkerError extends Error {
  readonly failure: SqliteFailure;
  constructor(failure: SqliteFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

/**
 * Runs one job on a fresh worker and resolves with its results. Rejects with
 * the signal's reason as soon as the signal aborts, and terminates the worker.
 */
export function runSqliteJob(job: SqliteJob, options: { signal: AbortSignal; debug: (message: string) => void }): Promise<SqliteStepResult[]> {
  const { signal, debug } = options;
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise((resolve, reject) => {
    const worker = new Worker(SOURCE, { eval: true, workerData: job, stderr: true, stdout: true });
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      fn();
      void worker.terminate();
    };
    const onAbort = () => finish(() => reject(signal.reason as Error));
    signal.addEventListener('abort', onAbort, { once: true });
    worker.stderr.on('data', (chunk: Buffer) => debug(`sqlite worker: ${chunk.toString('utf8').trim()}`));
    worker.stdout.resume();
    worker.on('message', (message: WorkerReply) =>
      finish(() => (message.ok ? resolve(message.results) : reject(new SqliteWorkerError(message.error)))),
    );
    worker.on('error', (err) => finish(() => reject(new SqliteWorkerError({ message: err.message }))));
    worker.on('exit', (code) => finish(() => reject(new SqliteWorkerError({ message: `The SQLite worker stopped (exit code ${code}) before answering.` }))));
  });
}
