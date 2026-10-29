import { isIP, connect as netConnect, type Socket } from 'node:net';
import { checkServerIdentity, connect as tlsConnect, type ConnectionOptions, type PeerCertificate } from 'node:tls';
import thrift, { type ThriftConnection, type TProtocol } from 'thrift';
import TCLIService from 'hive-driver/thrift/gen-nodejs/TCLIService.js';
import T from 'hive-driver/thrift/gen-nodejs/TCLIService_types.js';

/**
 * One HiveServer2 connection: a socket, the SASL PLAIN sign-in Hive and an
 * LDAP-secured Impala expect (or none, for a server that runs without
 * authentication), and the Thrift client generated from TCLIService.thrift,
 * which hive-driver ships. Pure JavaScript all the way down: Node's `net` and
 * `tls`, the `thrift` runtime, and nothing native. Kerberos would need a
 * native GSSAPI module, so it isn't here (see the `db` skill page).
 *
 * The Thrift runtime leaves a call waiting forever when the server drops the
 * connection, and it has no idea what a signal is. This file adds both: every
 * call settles when the socket closes, and stops waiting when the call's
 * signal aborts. Stopping the statement on the server is the session's job
 * (index.ts), which sends CancelOperation on this same link.
 *
 * The sign-in is a two-message conversation conducted in length-prefixed
 * frames. Most meetings could be shorter.
 */

// Thrift reports protocol oddities through console.log, and stdout belongs to the envelope.
thrift.setLogFunc(() => {});

export { T };

/** SASL message statuses (TSaslTransport). */
const SASL = { START: 1, OK: 2, BAD: 3, ERROR: 4, COMPLETE: 5 } as const;

export interface Hs2Status {
  statusCode: number;
  infoMessages?: string[] | null;
  sqlState?: string | null;
  errorCode?: number | null;
  errorMessage?: string | null;
}

/** node-int64's shape: eight big-endian bytes at an offset. */
export interface Int64Like {
  buffer: Buffer;
  offset: number;
}

export interface OperationHandle {
  hasResultSet: boolean;
  modifiedRowCount?: number | null;
}

export interface TypeQualifier {
  i32Value?: number | null;
  stringValue?: string | null;
}

export interface TypeEntry {
  primitiveEntry?: { type: number; typeQualifiers?: { qualifiers?: Record<string, TypeQualifier> | null } | null } | null;
  arrayEntry?: unknown;
  mapEntry?: unknown;
  structEntry?: unknown;
  unionEntry?: unknown;
  userDefinedTypeEntry?: unknown;
}

export interface ColumnDesc {
  columnName: string;
  typeDesc: { types: TypeEntry[] };
  position: number;
}

export interface ColumnValues {
  values: unknown[];
  nulls: Buffer;
}

/** One column of a columnar result: exactly one of these is set. */
export interface ResultColumnData {
  boolVal?: ColumnValues | null;
  byteVal?: ColumnValues | null;
  i16Val?: ColumnValues | null;
  i32Val?: ColumnValues | null;
  i64Val?: ColumnValues | null;
  doubleVal?: ColumnValues | null;
  stringVal?: ColumnValues | null;
  binaryVal?: ColumnValues | null;
}

export interface RowSetData {
  rows?: unknown[] | null;
  columns?: ResultColumnData[] | null;
}

/** What each method answers. Every response carries a status; the rest is per method. */
export interface Responses {
  OpenSession: { status: Hs2Status; serverProtocolVersion: number; sessionHandle: object; configuration?: Record<string, string> | null };
  CloseSession: { status: Hs2Status };
  ExecuteStatement: { status: Hs2Status; operationHandle?: OperationHandle | null };
  GetOperationStatus: {
    status: Hs2Status;
    operationState?: number | null;
    sqlState?: string | null;
    errorCode?: number | null;
    errorMessage?: string | null;
    numModifiedRows?: Int64Like | null;
    hasResultSet?: boolean | null;
  };
  CancelOperation: { status: Hs2Status };
  CloseOperation: { status: Hs2Status };
  GetResultSetMetadata: { status: Hs2Status; schema?: { columns: ColumnDesc[] } | null };
  FetchResults: { status: Hs2Status; hasMoreRows?: boolean | null; results?: RowSetData | null };
  GetSchemas: { status: Hs2Status; operationHandle?: OperationHandle | null };
  GetTables: { status: Hs2Status; operationHandle?: OperationHandle | null };
  GetColumns: { status: Hs2Status; operationHandle?: OperationHandle | null };
  GetPrimaryKeys: { status: Hs2Status; operationHandle?: OperationHandle | null };
  GetCrossReference: { status: Hs2Status; operationHandle?: OperationHandle | null };
  /** Impala's own close, which also reports what a DML statement changed (`impalaClose`, below). */
  CloseImpalaOperation: { status: Hs2Status; rowsModified?: number; rowsDeleted?: number };
}

export type Method = keyof Responses;

type Callback = (err: unknown, result: unknown) => void;
type Client = Record<Method, (req: object, callback: Callback) => void>;

/** The server refused the sign-in; `message` is what it said. */
export class SaslRefused extends Error {
  readonly kind = 'sasl-refused';
}

/**
 * The connection ended, or never got going: refused, reset, timed out, a TLS
 * failure, or closed by the server. `during` says how far it got; `code` is
 * Node's error code, when there was one.
 */
export class LinkFailed extends Error {
  readonly kind = 'link-failed';
  constructor(
    message: string,
    readonly during: 'connect' | 'sign-in' | 'call',
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** A Thrift-level failure: the server answered with an exception instead of a response. */
export class ProtocolFailed extends Error {
  readonly kind = 'protocol-failed';
}

export interface LinkOptions {
  host: string;
  port: number;
  /** Connect over TLS, trusting these CAs (undefined: Node's defaults), and checking the certificate names `host`, or `serverName` when it is set (the socket still goes to `host`). */
  tls?: { ca: string[] | undefined; serverName?: string };
  /** SASL PLAIN with these credentials; absent for a server that runs without authentication (NOSASL). */
  sasl?: { user: string; password: string };
  signal: AbortSignal;
  /** How long to wait for the connection, the TLS handshake and the sign-in, each. */
  timeoutMs: number;
}

/**
 * tls.connect's options for a link. With a serverName the socket still goes to
 * `host`, but SNI and the certificate's name check use serverName: Node checks
 * identity against `servername` before `host`, and the check is spelled out so
 * that stays true if that ever changes. rejectUnauthorized never leaves true.
 */
export function tlsOptions(host: string, port: number, tls: { ca: string[] | undefined; serverName?: string }): ConnectionOptions {
  const name = tls.serverName ?? host;
  return {
    host,
    port,
    ca: tls.ca,
    rejectUnauthorized: true,
    ...(isIP(name) ? {} : { servername: name }),
    ...(tls.serverName ? { checkServerIdentity: (_hostname: string, cert: PeerCertificate) => checkServerIdentity(name, cert) } : {}),
  };
}

export class Hs2Link {
  private readonly pending = new Set<(err: unknown) => void>();
  private failure: LinkFailed | undefined;

  private constructor(
    private readonly socket: Socket,
    private readonly connection: ThriftConnection,
    private readonly client: Client,
  ) {
    // Without listeners these would be unhandled 'error' events, which end the process.
    connection.on('error', (err: Error) => this.fail(new LinkFailed(err.message, 'call', (err as NodeJS.ErrnoException).code, { cause: err })));
    socket.on('error', (err: Error) => this.fail(new LinkFailed(err.message, 'call', (err as NodeJS.ErrnoException).code, { cause: err })));
    socket.on('close', () => this.fail(new LinkFailed('The server closed the connection.', 'call')));
  }

  /** Connects, signs in, and returns a link ready for calls. Destroys the socket on any failure. */
  static async open(options: LinkOptions): Promise<Hs2Link> {
    const { host, port, signal, timeoutMs } = options;
    if (signal.aborted) throw signal.reason;
    const socket = options.tls
      ? tlsConnect(tlsOptions(host, port, options.tls))
      : netConnect({ host, port });
    try {
      await settle(socket, options.tls ? 'secureConnect' : 'connect', 'connect', timeoutMs, signal);
      socket.setNoDelay(true);
      if (options.sasl) await signIn(socket, options.sasl, timeoutMs, signal);
      // After SASL every message is framed; a server with no SASL takes them unframed.
      const connection = new thrift.Connection(socket, { transport: options.sasl ? thrift.TFramedTransport : thrift.TBufferedTransport, protocol: thrift.TBinaryProtocol });
      // Thrift waits for the socket's 'connect' event before it writes, and that event has
      // already come and gone: the socket was connected, and signed in, before Thrift saw it.
      connection.connected = true;
      return new Hs2Link(socket, connection, thrift.createClient<Client>(TCLIService, connection));
    } catch (err) {
      socket.destroy();
      throw err;
    }
  }

  /**
   * One request. Settles when the server answers, when the connection fails,
   * or when `signal` aborts (with its reason), whichever comes first. A call
   * abandoned by its signal is still answered on the wire; the answer is
   * dropped.
   */
  call<M extends Method>(method: M, request: object, signal?: AbortSignal): Promise<Responses[M]> {
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise<Responses[M]>((resolve, reject) => {
      if (method === 'CloseImpalaOperation') impalaClose(this.client);
      let done = false;
      const finish = (err: unknown, result?: unknown) => {
        if (done) return;
        done = true;
        this.pending.delete(onFail);
        signal?.removeEventListener('abort', onAbort);
        if (err === undefined || err === null) resolve(result as Responses[M]);
        else reject(err);
      };
      const onFail = (err: unknown) => finish(err);
      const onAbort = () => finish(signal!.reason);
      this.pending.add(onFail);
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.client[method](request, (err, result) => finish(err ? asProtocolFailure(method, err) : null, result));
      } catch (err) {
        finish(asProtocolFailure(method, err));
      }
    });
  }

  /** Ends the connection at once. Anything still waiting fails. */
  close(): void {
    this.fail(new LinkFailed('The connection was closed.', 'call'));
    this.connection.end();
    this.socket.destroy();
  }

  private fail(err: LinkFailed): void {
    this.failure ??= err;
    for (const reject of [...this.pending]) reject(this.failure);
    this.pending.clear();
  }
}

const { Type, MessageType, TApplicationException } = thrift.Thrift;

interface GeneratedClient {
  _seqid: number;
  _reqs: Record<number, Callback>;
  output: { flush(): void };
  pClass: new (transport: unknown) => TProtocol;
  new_seqid(): number;
  seqid(): number;
}

/**
 * Impala's CloseImpalaOperation, written by hand in the generated client's
 * shape. HiveServer2's protocol has no row count for a DML statement; Impala
 * reports one only here, in its extension of the service (ImpalaService.thrift),
 * which hive-driver's generated code doesn't include. The arguments are the
 * operation handle; the answer is a status and `dml_result`, whose
 * `rows_modified` and `rows_deleted` are maps of partition to count, summed.
 * Installed on a client the first time it's needed.
 */
function impalaClose(client: Client): void {
  const c = client as unknown as GeneratedClient & Record<string, unknown>;
  if (c.recv_CloseImpalaOperation) return;
  c.CloseImpalaOperation = function (this: GeneratedClient, req: { operationHandle: object }, callback: Callback) {
    this._seqid = this.new_seqid();
    this._reqs[this.seqid()] = callback;
    const out = new this.pClass(this.output);
    out.writeMessageBegin('CloseImpalaOperation', MessageType.CALL, this.seqid());
    out.writeStructBegin('CloseImpalaOperation_args');
    out.writeFieldBegin('req', Type.STRUCT, 1);
    out.writeStructBegin('TCloseImpalaOperationReq');
    out.writeFieldBegin('operationHandle', Type.STRUCT, 1);
    new T.TOperationHandle(req.operationHandle as Record<string, unknown>).write(out);
    out.writeFieldEnd();
    out.writeFieldStop();
    out.writeStructEnd();
    out.writeFieldEnd();
    out.writeFieldStop();
    out.writeStructEnd();
    out.writeMessageEnd();
    this.output.flush();
  };
  // Called by the Thrift connection with the seqid it maps to the waiting callback.
  c.recv_CloseImpalaOperation = function (this: GeneratedClient, input: TProtocol, mtype: number, rseqid: number) {
    const callback = this._reqs[rseqid] ?? (() => {});
    delete this._reqs[rseqid];
    if (mtype === MessageType.EXCEPTION) {
      const x = new TApplicationException();
      x.read(input);
      input.readMessageEnd();
      return callback(x, undefined);
    }
    let result: Responses['CloseImpalaOperation'] | undefined;
    readStruct(input, (fid, ftype) => {
      if (fid !== 0 || ftype !== Type.STRUCT) return false;
      const response: Responses['CloseImpalaOperation'] = { status: { statusCode: T.TStatusCode.SUCCESS_STATUS! } };
      readStruct(input, (id, type) => {
        if (id === 1 && type === Type.STRUCT) {
          const status = new T.TStatus();
          status.read(input);
          response.status = status as unknown as Hs2Status;
        } else if (id === 2 && type === Type.STRUCT) {
          readStruct(input, (dml, kind) => {
            if ((dml !== 1 && dml !== 3) || kind !== Type.MAP) return false;
            const total = readCounts(input);
            if (dml === 1) response.rowsModified = total;
            else response.rowsDeleted = total;
            return true;
          });
        } else return false;
        return true;
      });
      result = response;
      return true;
    });
    input.readMessageEnd();
    return result ? callback(null, result) : callback('CloseImpalaOperation failed: unknown result', undefined);
  };
}

/** Reads a struct, handing each field to `field`; one it doesn't read (returns false) is skipped. */
function readStruct(input: TProtocol, field: (fid: number, ftype: number) => boolean): void {
  input.readStructBegin();
  for (;;) {
    const { ftype, fid } = input.readFieldBegin();
    if (ftype === Type.STOP) break;
    if (!field(fid, ftype)) input.skip(ftype);
    input.readFieldEnd();
  }
  input.readStructEnd();
}

/** The sum of a map<string, i64>. */
function readCounts(input: TProtocol): number {
  const { size } = input.readMapBegin();
  let total = 0n;
  for (let i = 0; i < size; i++) {
    input.readString();
    const n = input.readI64();
    total += n.buffer.readBigInt64BE(n.offset);
  }
  input.readMapEnd();
  return Number(total);
}

function asProtocolFailure(method: Method, err: unknown): Error {
  if (err instanceof Error) return err;
  // The generated client reports a missing result as a bare string, and a server exception as a TApplicationException.
  const message = typeof err === 'string' ? err : String((err as { message?: unknown })?.message ?? err);
  return new ProtocolFailed(`${method}: ${message}`);
}

/** Waits for `event`, failing on an error, a close, the time limit or the signal. */
function settle(socket: Socket, event: string, during: 'connect' | 'sign-in', timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(event, onEvent);
      socket.off('error', onError);
      socket.off('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = (err: NodeJS.ErrnoException) => {
      cleanup();
      reject(new LinkFailed(err.message, during, err.code, { cause: err }));
    };
    const onClose = () => {
      cleanup();
      reject(new LinkFailed('The server closed the connection.', during));
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new LinkFailed(`No answer within ${timeoutMs / 1000}s.`, during, 'ETIMEDOUT'));
    }, timeoutMs);
    socket.once(event, onEvent);
    socket.once('error', onError);
    socket.once('close', onClose);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** A SASL message: one status byte, a four-byte big-endian length, the payload. */
export function saslMessage(status: number, payload: Buffer): Buffer {
  const out = Buffer.alloc(5 + payload.length);
  out[0] = status;
  out.writeUInt32BE(payload.length, 1);
  payload.copy(out, 5);
  return out;
}

/**
 * SASL PLAIN, as HiveServer2's TSaslServerTransport expects it: START with the
 * mechanism, then OK with `\0user\0password` (no authorization id), then wait
 * for COMPLETE. BAD or ERROR carries the server's reason.
 */
async function signIn(socket: Socket, credentials: { user: string; password: string }, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const reply = new Promise<void>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      signal.removeEventListener('abort', onAbort);
    };
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      if (buffered.length < 5) return;
      const length = buffered.readUInt32BE(1);
      if (buffered.length < 5 + length) return;
      cleanup();
      const status = buffered[0];
      const message = buffered.subarray(5, 5 + length).toString('utf8');
      if (status === SASL.COMPLETE) resolve();
      else if (status === SASL.BAD || status === SASL.ERROR) reject(new SaslRefused(message || 'the server gave no reason'));
      // A server that wants another round (a challenge) isn't speaking PLAIN.
      else reject(new SaslRefused(`unexpected SASL status ${status}${message ? `: ${message}` : ''}`));
    };
    const onError = (err: NodeJS.ErrnoException) => {
      cleanup();
      reject(new LinkFailed(err.message, 'sign-in', err.code, { cause: err }));
    };
    const onClose = () => {
      cleanup();
      reject(new LinkFailed('The server closed the connection during sign-in.', 'sign-in'));
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new LinkFailed(`No answer to the sign-in within ${timeoutMs / 1000}s.`, 'sign-in', 'ETIMEDOUT'));
    }, timeoutMs);
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  socket.write(saslMessage(SASL.START, Buffer.from('PLAIN')));
  socket.write(saslMessage(SASL.OK, Buffer.concat([Buffer.from([0]), Buffer.from(credentials.user, 'utf8'), Buffer.from([0]), Buffer.from(credentials.password, 'utf8')])));
  await reply;
}
