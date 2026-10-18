// Types for the pg modules imported by path, and for pg-cursor. The provider imports pg's
// Client directly rather than the package index, which would also pull in
// pg-pool and the lazy loader for the native binding toil must never load.
// Declared here because the driver ships without them; the forms were filled
// in by hand, as forms are.

declare module 'pg/lib/client.js' {
  import { Client } from 'pg';
  export default Client;
}

declare module 'pg/lib/type-overrides.js' {
  import type { CustomTypesConfig } from 'pg';
  export default class TypeOverrides implements CustomTypesConfig {
    setTypeParser(oid: number, format: 'text', parse: (value: string) => unknown): void;
    getTypeParser: CustomTypesConfig['getTypeParser'];
  }
}

declare module 'pg-cursor' {
  import type { CustomTypesConfig, FieldDef } from 'pg';
  export default class Cursor {
    constructor(text: string, values: unknown[] | null, config?: { rowMode?: 'array'; types?: CustomTypesConfig });
    read(rows: number, callback: (err: Error | undefined, rows: unknown[][], result: { fields: FieldDef[] }) => void): void;
    close(): Promise<void>;
  }
}
