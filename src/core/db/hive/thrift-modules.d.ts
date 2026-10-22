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

  interface Thrift {
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
  const types: {
    TProtocolVersion: Record<string, number>;
    TTypeId: Record<string, number>;
    TStatusCode: Record<string, number>;
    TOperationState: Record<string, number>;
    TFetchOrientation: Record<string, number>;
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
