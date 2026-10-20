/**
 * `mapOwi` as `@imagile-dev/toil/api` defines it, for a browser. The API's
 * entry also loads the CLI's Node-only parts (the credential store, the
 * config), so a page can't import it; this is the same three lines over the
 * same mappers in src/core/owi/, and test/registry.test.ts holds its output to
 * the real `mapOwi`'s on every dossier the preview serves. The local app will
 * call the API's own, in Node, and hand the page the result. Two copies of a
 * form, kept identical by test rather than by memo.
 */

import { documentsFrom, fieldOverrides, inputValues, mapOwi as mapDocuments, parseOwiInput, type OwiResult } from '../../src/core/owi/index.ts';

export { OVERRIDABLE } from '../../src/core/owi/index.ts';

export type { OwiResult } from '../../src/core/owi/index.ts';

export interface OwiMapOptions {
  fields?: Record<string, string> | string[];
  command?: string;
  key?: string;
}

export function mapOwi(input: unknown, options: OwiMapOptions = {}): OwiResult {
  const values = typeof input === 'string' ? parseOwiInput(input) : inputValues(input);
  const { documents, skipped } = documentsFrom(values, { command: options.command, key: options.key });
  return mapDocuments(documents, { fields: fieldOverrides(options.fields), skipped });
}
