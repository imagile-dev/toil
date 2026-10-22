// Types for the Thrift runtime and for the HiveServer2 client generated from
// TCLIService.thrift, which hive-driver ships as plain JavaScript. Neither has
// types upstream; these cover only what hs2.ts touches. The rest of the
// protocol remains undocumented here, in keeping with tradition.

declare module 'thrift' {
  import type { EventEmitter } from 'node:events';
  import type { Duplex } from 'node:stream';

  export interface ThriftConnection extends EventEmitter {
    connected: boolean;
    end(): void;
    destroy(): void;
  }

  /** A protocol as the generated code reads it; only the calls hs2.ts makes. */
  export interface TProtocol {
    writeMessageBegin(name: string, type: number, seqid: number): void;
    writeMessageEnd(): void;
    writeStructBegin(name: string): void;
    writeStructEnd(): void;
    writeFieldBegin(name: string, type: number, id: number): void;
    writeFieldEnd(): void;
    writeFieldStop(): void;
    readMessageEnd(): void;
    readStructBegin(): void;
    readStructEnd(): void;
    readFieldBegin(): { fname: string; ftype: number; fid: number };
    readFieldEnd(): void;
    readMapBegin(): { ktype: number; vtype: number; size: number };
    readMapEnd(): void;
    readString(): string;
    readI64(): { buffer: Buffer; offset: number };
    skip(type: number): void;
  }

  interface Thrift {
    Thrift: {
      Type: Record<'STOP' | 'STRUCT' | 'MAP' | 'STRING' | 'I64', number>;
      MessageType: Record<'CALL' | 'EXCEPTION', number>;
      TApplicationException: new () => Error & { read(input: TProtocol): void };
    };
    Connection: new (stream: Duplex, options: { transport: unknown; protocol: unknown }) => ThriftConnection;
    createClient<T>(service: unknown, connection: ThriftConnection): T;
    TFramedTransport: unknown;
    TBufferedTransport: unknown;
    TBinaryProtocol: unknown;
    setLogFunc(fn: (...args: unknown[]) => void): void;
  }
  const thrift: Thrift;
  export default thrift;
}

declare module 'hive-driver/thrift/gen-nodejs/TCLIService.js' {
  const service: unknown;
  export default service;
}

declare module 'hive-driver/thrift/gen-nodejs/TCLIService_types.js' {
  /** A generated request struct: built from a plain object of its fields, then written by the client. */
  type Struct = new (fields: Record<string, unknown>) => object;
  /** A generated struct that can read itself from, or write itself to, a protocol. */
  type Readable = new (fields?: Record<string, unknown>) => { read(input: unknown): void; write(output: unknown): void };
  const types: {
    TProtocolVersion: Record<string, number>;
    TTypeId: Record<string, number>;
    TStatusCode: Record<string, number>;
    TOperationState: Record<string, number>;
    TFetchOrientation: Record<string, number>;
    TStatus: Readable;
    TOperationHandle: Readable;
    TOpenSessionReq: Struct;
    TCloseSessionReq: Struct;
    TExecuteStatementReq: Struct;
    TGetOperationStatusReq: Struct;
    TCancelOperationReq: Struct;
    TCloseOperationReq: Struct;
    TGetResultSetMetadataReq: Struct;
    TFetchResultsReq: Struct;
    TGetSchemasReq: Struct;
    TGetTablesReq: Struct;
    TGetColumnsReq: Struct;
    TGetPrimaryKeysReq: Struct;
    TGetCrossReferenceReq: Struct;
  };
  export default types;
}
