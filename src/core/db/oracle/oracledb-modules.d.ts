// The driver's wire buffer, imported by path so dates.ts can read a date's
// bytes before Thin mode turns them into a local-time Date. Untyped upstream;
// typed here, only as far as toil touches it.
declare module 'oracledb/lib/impl/datahandlers/buffer.js' {
  export class BaseBuffer {
    readBytesWithLength(): Uint8Array | null;
    parseOracleDate(buf: Uint8Array, useLocalTime?: boolean): Date;
    readOracleDate(useLocalTime: boolean): Date | null;
  }
}
