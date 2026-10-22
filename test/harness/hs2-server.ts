import { randomBytes } from 'node:crypto';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import thrift, { type TProtocol } from 'thrift';
import TCLIService from 'hive-driver/thrift/gen-nodejs/TCLIService.js';
import T from 'hive-driver/thrift/gen-nodejs/TCLIService_types.js';

/**
 * A HiveServer2 that lives in the test process, for the Hive and Impala
 * provider's offline tests. It speaks the real protocol: SASL PLAIN (or none),
 * then Thrift's binary protocol over the same TCLIService the provider's
 * client is generated from, so the tests drive hs2.ts and index.ts exactly as
 * a server would, with no Docker and no network.
 *
 * A test describes what each statement does (`statements`) and what the
 * catalog calls return (`catalog`); every request is recorded in `calls`, so a
 * test can check what the provider asked for, and in what order. The server
 * holds no data of its own and agrees with whatever it's told, which makes it
 * the most cooperative HiveServer2 on record.
 */

export interface FakeColumn {
  name: string;
  /** A TTypeId name: INT_TYPE, STRING_TYPE, DECIMAL_TYPE ... */
  type: string;
  qualifiers?: Record<string, number>;
}

export type FakeStatement =
  | { columns: FakeColumn[]; rows: unknown[][]; modified?: number }
  | { modified: number; impala?: { rowsModified?: number; rowsDeleted?: number } }
  | { error: { sqlState?: string; errorCode?: number; errorMessage: string }; async?: boolean }
  /** Runs until cancelled, reporting RUNNING. */
  | { hang: true };

export interface FakeOptions {
  /** SASL PLAIN credentials to accept; a string is the message for refusing any sign-in. Absent: no SASL. */
  sasl?: { user: string; password: string } | { refuse: string };
  /** What OpenSession reports as the protocol version (0-based, V10 is 9). */
  protocol?: number;
  /** Rows per FetchResults the server will send at most, to make the client page. */
  batch?: number;
  statements?: Record<string, FakeStatement>;
  /** Catalog calls' answers, by method: columns and rows. */
  catalog?: Partial<Record<'GetSchemas' | 'GetTables' | 'GetColumns' | 'GetPrimaryKeys' | 'GetCrossReference', { columns: FakeColumn[]; rows: unknown[][] } | { error: string }>>;
  /** Empty batches, each with hasMoreRows true, before a statement's rows: what Impala sends when no row was ready in time. */
  stall?: number;
  /** OpenSession's status, to refuse a session (a missing database). */
  openError?: string;
}

export interface FakeCall {
  method: string;
  /** Which connection (1, 2, ...) it arrived on. */
  connection: number;
  request: Record<string, unknown>;
}

export interface FakeHs2 {
  port: number;
  calls: FakeCall[];
  /** Statements that were cancelled. */
  cancelled: string[];
  close(): Promise<void>;
}

const OK = { statusCode: 0 };
const error = (errorMessage: string, extra: Record<string, unknown> = {}) => ({ statusCode: 3, errorMessage, ...extra });

interface Operation {
  sql: string;
  statement: FakeStatement | { columns: FakeColumn[]; rows: unknown[][] };
  cursor: number;
  state: number;
  stalled: number;
}

const VALUE_FIELD: Record<string, string> = {
  BOOLEAN_TYPE: 'boolVal',
  TINYINT_TYPE: 'byteVal',
  SMALLINT_TYPE: 'i16Val',
  INT_TYPE: 'i32Val',
  BIGINT_TYPE: 'i64Val',
  FLOAT_TYPE: 'doubleVal',
  DOUBLE_TYPE: 'doubleVal',
  BINARY_TYPE: 'binaryVal',
};

/** One column of rows in HiveServer2's columnar form: the values, and a bitmap of the nulls. */
function column(type: string, values: unknown[]): Record<string, unknown> {
  const field = VALUE_FIELD[type] ?? 'stringVal';
  const nulls = Buffer.alloc(Math.ceil(values.length / 8));
  const filler = field === 'stringVal' ? '' : field === 'binaryVal' ? Buffer.alloc(0) : field === 'boolVal' ? false : 0;
  const cleaned = values.map((v, i) => {
    if (v === null || v === undefined) {
      nulls[i >> 3]! |= 1 << (i & 7);
      return filler;
    }
    if (field === 'i64Val' && typeof v === 'bigint') return new thrift.Int64(Buffer.from(BigInt.asUintN(64, v).toString(16).padStart(16, '0'), 'hex'));
    return v;
  });
  return { [field]: { values: cleaned, nulls } };
}

function typeDesc(c: FakeColumn): Record<string, unknown> {
  const qualifiers = c.qualifiers ? { qualifiers: Object.fromEntries(Object.entries(c.qualifiers).map(([k, v]) => [k, { i32Value: v }])) } : null;
  return { types: [{ primitiveEntry: { type: T.TTypeId[c.type], typeQualifiers: qualifiers } }] };
}

const guid = () => randomBytes(16);
const key = (handle: { operationId: { guid: Buffer } }) => handle.operationId.guid.toString('hex');

export async function fakeHs2(options: FakeOptions = {}): Promise<FakeHs2> {
  const calls: FakeCall[] = [];
  const cancelled: string[] = [];
  const operations = new Map<string, Operation>();
  let connections = 0;
  const batch = options.batch ?? 1000;

  const start = (sql: string, statement: Operation['statement']) => {
    const id = guid();
    operations.set(id.toString('hex'), { sql, statement, cursor: 0, stalled: 0, state: 'hang' in statement ? T.TOperationState.RUNNING_STATE! : T.TOperationState.FINISHED_STATE! });
    return { status: OK, operationHandle: { operationId: { guid: id, secret: guid() }, operationType: 0, hasResultSet: 'columns' in statement } };
  };

  // One handler per connection, so each call records which connection it came on.
  const handler = (connection: number) => {
    const record = (method: string, request: Record<string, unknown>) => calls.push({ method, connection, request });
    const catalog = (method: keyof NonNullable<FakeOptions['catalog']>) => (req: Record<string, unknown>) => {
      record(method, req);
      const answer = options.catalog?.[method] ?? { columns: [{ name: 'X', type: 'STRING_TYPE' }], rows: [] };
      if ('error' in answer) return { status: error(answer.error) };
      return start(method, answer);
    };
    return {
      OpenSession(req: Record<string, unknown>) {
        record('OpenSession', req);
        if (options.openError) return { status: error(options.openError), serverProtocolVersion: options.protocol ?? 9 };
        return { status: OK, serverProtocolVersion: options.protocol ?? 9, sessionHandle: { sessionId: { guid: guid(), secret: guid() } }, configuration: {} };
      },
      CloseSession(req: Record<string, unknown>) {
        record('CloseSession', req);
        return { status: OK };
      },
      ExecuteStatement(req: { statement: string }) {
        record('ExecuteStatement', req as unknown as Record<string, unknown>);
        const statement = options.statements?.[req.statement];
        if (!statement) return { status: error(`Table not found in: ${req.statement}`, { sqlState: '42S02', errorCode: 10001 }) };
        if ('error' in statement && !statement.async) return { status: { statusCode: 3, ...statement.error } };
        return start(req.statement, statement);
      },
      GetOperationStatus(req: { operationHandle: { operationId: { guid: Buffer } } }) {
        record('GetOperationStatus', req as unknown as Record<string, unknown>);
        const op = operations.get(key(req.operationHandle));
        if (!op) return { status: { statusCode: 4, errorMessage: 'Invalid OperationHandle' } };
        if ('error' in op.statement) return { status: OK, operationState: T.TOperationState.ERROR_STATE, ...op.statement.error };
        const modified = 'modified' in op.statement && op.statement.modified !== undefined ? op.statement.modified : 0;
        return { status: OK, operationState: op.state, numModifiedRows: modified, hasResultSet: 'columns' in op.statement };
      },
      CancelOperation(req: { operationHandle: { operationId: { guid: Buffer } } }) {
        record('CancelOperation', req as unknown as Record<string, unknown>);
        const op = operations.get(key(req.operationHandle));
        if (!op) return { status: { statusCode: 4, errorMessage: 'Invalid OperationHandle' } };
        op.state = T.TOperationState.CANCELED_STATE!;
        cancelled.push(op.sql);
        return { status: OK };
      },
      CloseOperation(req: { operationHandle: { operationId: { guid: Buffer } } }) {
        record('CloseOperation', req as unknown as Record<string, unknown>);
        operations.delete(key(req.operationHandle));
        return { status: OK };
      },
      GetResultSetMetadata(req: { operationHandle: { operationId: { guid: Buffer } } }) {
        record('GetResultSetMetadata', req as unknown as Record<string, unknown>);
        const op = operations.get(key(req.operationHandle))!;
        const columns = 'columns' in op.statement ? op.statement.columns : [];
        return { status: OK, schema: { columns: columns.map((c, i) => ({ columnName: c.name, typeDesc: typeDesc(c), position: i + 1 })) } };
      },
      FetchResults(req: { operationHandle: { operationId: { guid: Buffer } }; maxRows: number | { toNumber(): number } }) {
        record('FetchResults', req as unknown as Record<string, unknown>);
        const op = operations.get(key(req.operationHandle))!;
        const statement = op.statement as { columns: FakeColumn[]; rows: unknown[][] };
        if (op.stalled < (options.stall ?? 0)) {
          op.stalled++;
          return { status: OK, hasMoreRows: true, results: { startRowOffset: 0, rows: [], columns: statement.columns.map((c) => column(c.type, [])) } };
        }
        const max = Math.min(typeof req.maxRows === 'number' ? req.maxRows : req.maxRows.toNumber(), batch);
        const rows = statement.rows.slice(op.cursor, op.cursor + max);
        op.cursor += rows.length;
        // Like Hive: hasMoreRows stays false even when rows remain.
        return { status: OK, hasMoreRows: false, results: { startRowOffset: 0, rows: [], columns: statement.columns.map((c, i) => column(c.type, rows.map((r) => r[i]))) } };
      },
      GetSchemas: catalog('GetSchemas'),
      GetTables: catalog('GetTables'),
      GetColumns: catalog('GetColumns'),
      GetPrimaryKeys: catalog('GetPrimaryKeys'),
      GetCrossReference: catalog('GetCrossReference'),
    };
  };

  /** Impala's CloseImpalaOperation, which the generated processor doesn't know: read by hand, answered by hand. */
  const impalaClose = function (this: { _handler: { connection: number } }, seqid: number, input: TProtocol, output: TProtocol & { flush(): void; writeI64(n: number): void; writeString(s: string): void; writeMapBegin(k: number, v: number, n: number): void; writeMapEnd(): void }) {
      const connection = this._handler.connection;
      const { Type, MessageType } = thrift.Thrift;
      let handle: { operationId: { guid: Buffer } } | undefined;
      const readStruct = (field: (fid: number, ftype: number) => boolean) => {
        input.readStructBegin();
        for (;;) {
          const { ftype, fid } = input.readFieldBegin();
          if (ftype === Type.STOP) break;
          if (!field(fid, ftype)) input.skip(ftype);
          input.readFieldEnd();
        }
        input.readStructEnd();
      };
      readStruct((fid) => {
        if (fid !== 1) return false;
        readStruct((id) => {
          if (id !== 1) return false;
          const h = new T.TOperationHandle();
          h.read(input);
          handle = h as unknown as typeof handle;
          return true;
        });
        return true;
      });
      input.readMessageEnd();
      calls.push({ method: 'CloseImpalaOperation', connection, request: { operationHandle: handle } });
      const op = handle ? operations.get(key(handle)) : undefined;
      if (handle) operations.delete(key(handle));
      const counts = op && 'impala' in op.statement ? op.statement.impala : undefined;
      output.writeMessageBegin('CloseImpalaOperation', MessageType.REPLY, seqid);
      output.writeStructBegin('result');
      output.writeFieldBegin('success', Type.STRUCT, 0);
      output.writeStructBegin('TCloseImpalaOperationResp');
      output.writeFieldBegin('status', Type.STRUCT, 1);
      new T.TStatus({ statusCode: 0 }).write(output);
      output.writeFieldEnd();
      if (counts) {
        output.writeFieldBegin('dml_result', Type.STRUCT, 2);
        output.writeStructBegin('TDmlResult');
        for (const [id, n] of [[1, counts.rowsModified], [3, counts.rowsDeleted]] as const) {
          if (n === undefined) continue;
          output.writeFieldBegin('rows', Type.MAP, id);
          output.writeMapBegin(Type.STRING, Type.I64, 1);
          output.writeString('');
          output.writeI64(n);
          output.writeMapEnd();
          output.writeFieldEnd();
        }
        output.writeFieldStop();
        output.writeStructEnd();
        output.writeFieldEnd();
      }
      output.writeFieldStop();
      output.writeStructEnd();
      output.writeFieldStop();
      output.writeStructEnd();
      output.writeMessageEnd();
      output.flush();
    };

  const sockets = new Set<Socket>();
  // The generated processor answers what TCLIService defines; Impala's close is added beside it.
  (TCLIService as { Processor: { prototype: Record<string, unknown> } }).Processor.prototype.process_CloseImpalaOperation = impalaClose;
  const serve = (socket: Socket) => {
    const connection = ++connections;
    const server: Server = thrift.createServer(TCLIService, { ...handler(connection), connection }, {
      transport: options.sasl ? thrift.TFramedTransport : thrift.TBufferedTransport,
      protocol: thrift.TBinaryProtocol,
    });
    // The Thrift server's own connection handler, given a socket that has already signed in.
    const accept = server.listeners('connection')[0] as (s: Socket) => void;
    accept.call(server, socket);
  };

  const front = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (!options.sasl) return serve(socket);
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      const frames: Array<{ status: number; payload: Buffer }> = [];
      let at = 0;
      while (buffered.length - at >= 5) {
        const length = buffered.readUInt32BE(at + 1);
        if (buffered.length - at < 5 + length) break;
        frames.push({ status: buffered[at]!, payload: buffered.subarray(at + 5, at + 5 + length) });
        at += 5 + length;
      }
      const ok = frames.find((f) => f.status === 2);
      if (!ok) return;
      socket.off('data', onData);
      const sasl = options.sasl!;
      const [, user, password] = ok.payload.toString('utf8').split('\0');
      const reply = (status: number, message: string) => {
        const out = Buffer.alloc(5 + Buffer.byteLength(message));
        out[0] = status;
        out.writeUInt32BE(Buffer.byteLength(message), 1);
        out.write(message, 5);
        socket.write(out);
      };
      if ('refuse' in sasl) {
        reply(3, sasl.refuse);
        socket.end();
      } else if (user !== sasl.user || password !== sasl.password) {
        reply(4, 'Error validating the login');
        socket.end();
      } else {
        reply(5, '');
        serve(socket);
      }
    };
    socket.on('data', onData);
  });
  await new Promise<void>((resolve) => front.listen(0, '127.0.0.1', resolve));
  return {
    port: (front.address() as AddressInfo).port,
    calls,
    cancelled,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        front.close(() => resolve());
      }),
  };
}
