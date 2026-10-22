/**
 * Stand-in for `isomorphic-ws` in the bundle. The Thrift runtime that Hive and
 * Impala's provider uses loads every transport it has when it starts, a
 * WebSocket client among them, and `ws` reaches for two optional native
 * addons (`bufferutil`, `utf-8-validate`) that the purity gate rightly
 * refuses. toil talks to HiveServer2 over a plain socket and never opens a
 * WebSocket, so the module is replaced here and anything that reaches for it
 * fails loudly.
 *
 * The WebSocket transport applied for a seat in the bundle and was told the
 * position had been filled by a socket.
 */
export default class Refused {
  constructor() {
    throw new Error('toil does not open WebSocket connections. This is a bug; please report it at https://github.com/imagile-dev/toil/issues.');
  }
}
