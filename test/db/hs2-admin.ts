import { Hs2Link, T, type Hs2Status, type OperationHandle } from '../../src/core/db/hive/hs2.js';
import { decodeRows } from '../../src/core/db/hive/rows.js';

/**
 * Test-side HiveServer2 access for the Hive and Impala targets: seeding a
 * database, checking what a command changed, and dropping it again, outside
 * toil's provider so the provider can't vouch for itself. It uses the same
 * connection code (hs2.ts), which the provider's own tests cover separately.
 * Administration, conducted over the same protocol as everything else, with
 * fewer forms.
 */

export interface Hs2Server {
  host: string;
  port: number;
  /** null for a server with no authentication (NOSASL). */
  password: string | null;
}

function check(status: Hs2Status | null | undefined, sql: string): void {
  if (status && status.statusCode >= 3) throw new Error(`${sql}: ${status.errorMessage ?? 'failed'}`);
}

/** Runs each statement in order as `user`, waiting for each to finish, and returns the last one's rows as objects. */
export async function hs2Run(server: Hs2Server, user: string, statements: string[]): Promise<Array<Record<string, unknown>>> {
  const signal = AbortSignal.timeout(120_000);
  const link = await Hs2Link.open({
    host: server.host,
    port: server.port,
    ...(server.password === null ? {} : { sasl: { user, password: server.password } }),
    signal,
    timeoutMs: 10_000,
  });
  try {
    const opened = await link.call('OpenSession', new T.TOpenSessionReq({ client_protocol: T.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V10, username: user, configuration: {} }), signal);
    check(opened.status, 'OpenSession');
    const session = opened.sessionHandle;
    let rows: Array<Record<string, unknown>> = [];
    for (const sql of statements) {
      const started = await link.call('ExecuteStatement', new T.TExecuteStatementReq({ sessionHandle: session, statement: sql, runAsync: true }), signal);
      check(started.status, sql);
      const handle = started.operationHandle as OperationHandle;
      for (;;) {
        const status = await link.call('GetOperationStatus', new T.TGetOperationStatusReq({ operationHandle: handle }), signal);
        check(status.status, sql);
        if (status.operationState === T.TOperationState.FINISHED_STATE) break;
        if (status.operationState !== T.TOperationState.RUNNING_STATE && status.operationState !== T.TOperationState.INITIALIZED_STATE && status.operationState !== T.TOperationState.PENDING_STATE) {
          throw new Error(`${sql}: ${status.errorMessage ?? `state ${status.operationState}`}`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      rows = [];
      if (handle.hasResultSet) {
        const meta = await link.call('GetResultSetMetadata', new T.TGetResultSetMetadataReq({ operationHandle: handle }), signal);
        const names = [...(meta.schema?.columns ?? [])].sort((a, b) => a.position - b.position).map((c) => c.columnName.split('.').pop()!);
        for (;;) {
          const fetched = await link.call('FetchResults', new T.TFetchResultsReq({ operationHandle: handle, orientation: T.TFetchOrientation.FETCH_NEXT, maxRows: 1000 }), signal);
          const batch = decodeRows(fetched.results);
          if (batch.length === 0) break;
          rows.push(...batch.map((r) => Object.fromEntries(names.map((n, i) => [n, typeof r[i] === 'bigint' ? Number(r[i]) : r[i]]))));
        }
      }
      await link.call('CloseOperation', new T.TCloseOperationReq({ operationHandle: handle }), signal);
    }
    await link.call('CloseSession', new T.TCloseSessionReq({ sessionHandle: session }), signal);
    return rows;
  } finally {
    link.close();
  }
}
