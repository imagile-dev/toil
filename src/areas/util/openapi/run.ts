import { ToilError } from '../../../core/errors.js';
import type { InputContext, UtilInput } from '../kit/input.js';
import { Verifier, type Verified } from '../kit/verify.js';
import { atPointer, checkDocument, isObject, type DocumentReport, type JsonObject, type LoadedDocument, loadDocument, type Spec } from './document.js';
import { checkExample, generateExample, MAX_NODES as MAX_EXAMPLE_NODES, MAX_STRING, type Direction } from './example.js';
import { checkOperations, findOperation, MAX_CHARS as MAX_SHOW_CHARS, MAX_NESTING, MAX_NODES, operations, requestBody, responses, showOperation, summarise, type Operation, type OperationSummary, type ShownOperation } from './operations.js';

/**
 * What the three `util openapi` commands run, loaded only when one of them
 * does (docs/util.md, Lazy loading). Each one reads the document, validates
 * it against its version's schema, checks every `$ref` and the operations,
 * and only then answers, so every answer carries the same `verified`. The
 * document is re-checked on every call, the way every form is re-verified at
 * every desk it reaches.
 */

type Selector = { operation?: string | undefined; method?: string | undefined; path?: string | undefined };

export interface DocumentSummary extends DocumentReport {
  /** Each server's URL as written; for Swagger 2.0, built from `schemes`, `host` and `basePath`. */
  servers: string[];
  /** How many operations the document has. */
  operations: number;
}

function servers(doc: JsonObject, spec: Spec): string[] {
  if (spec !== 'swagger-2.0') return Array.isArray(doc.servers) ? doc.servers.flatMap((s) => (isObject(s) && typeof s.url === 'string' ? [s.url] : [])) : [];
  if (typeof doc.host !== 'string') return typeof doc.basePath === 'string' ? [doc.basePath] : [];
  const schemes = Array.isArray(doc.schemes) && doc.schemes.length ? doc.schemes.filter((s): s is string => typeof s === 'string') : ['https'];
  return schemes.map((scheme) => `${scheme}://${doc.host}${typeof doc.basePath === 'string' ? doc.basePath : ''}`);
}

/** Reads and checks the document: what every command starts with. */
async function open(input: UtilInput, v: Verifier): Promise<{ loaded: LoadedDocument; document: DocumentSummary; ops: Operation[] }> {
  const loaded = await loadDocument(input);
  v.inputComplete(input);
  const report = await checkDocument(loaded, v);
  const ops = operations(loaded.doc);
  checkOperations(loaded.doc, ops, v);
  return { loaded, document: { ...report, servers: servers(loaded.doc, loaded.spec), operations: ops.length }, ops };
}

export interface ListData {
  document: DocumentSummary;
  /** How many operations matched the filters. */
  count: number;
  operations: OperationSummary[];
  verified: Verified;
}

export async function listOperations(ctx: InputContext, source: UtilInput, input: { tag?: string | undefined; path?: string | undefined }): Promise<ListData> {
  const v = new Verifier(ctx.warn);
  const { document, ops } = await open(source, v);
  const tag = input.tag?.toLowerCase();
  const path = input.path?.toLowerCase();
  const listed = ops
    .map(summarise)
    .filter((o) => (tag === undefined || o.tags.some((t) => t.toLowerCase() === tag)) && (path === undefined || o.path.toLowerCase().includes(path)));
  return { document, count: listed.length, operations: listed, verified: v.done() };
}

export type ShowData = { document: DocumentSummary } & ShownOperation & { verified: Verified };

export async function showOne(ctx: InputContext, source: UtilInput, input: Selector & { depth?: number | undefined }): Promise<ShowData> {
  const v = new Verifier(ctx.warn);
  const { loaded, document, ops } = await open(source, v);
  const shown = showOperation(loaded, findOperation(ops, input), input.depth ?? 3);
  if (shown.expansion.truncated) {
    ctx.warn({
      code: 'OPENAPI_EXPANSION_TRUNCATED',
      message: `Expanding $refs stopped at its limits (${MAX_NODES} objects and arrays, ${MAX_SHOW_CHARS} characters, ${MAX_NESTING} levels); every ref after that is left in place with x-toil-stop "depth", and any other value past the limit is null. Pass a smaller depth to see the whole operation at that depth.`,
    });
  }
  return { document, ...shown, verified: v.done() };
}

export interface ExampleData {
  document: DocumentSummary;
  operation: OperationSummary;
  /** `request`, or the response status the example is for. */
  body: 'request' | 'response';
  status: string | null;
  contentType: string | null;
  /** Where the schema the example satisfies is, as a JSON pointer; null for a Swagger form built from formData parameters. */
  schemaPointer: string | null;
  example: unknown;
  verified: Verified;
}

export async function exampleBody(ctx: InputContext, source: UtilInput, input: Selector & { response?: string | undefined; contentType?: string | undefined }): Promise<ExampleData> {
  const v = new Verifier(ctx.warn);
  const { loaded, document, ops } = await open(source, v);
  const { doc, spec } = loaded;
  const o = findOperation(ops, input);
  const name = `${o.method} ${o.path}`;
  const direction: Direction = input.response === undefined ? 'request' : 'response';
  let body;
  if (direction === 'request') {
    body = requestBody(doc, spec, o, input.contentType);
    if (!body) throw new ToilError('INVALID_INPUT', `${name} has no request body.`, { fix: 'Pass response with a status (200, 201, default) for an example of a response body instead.' });
  } else {
    const all = responses(doc, spec, o, input.contentType);
    body = all.find((r) => r.status === input.response);
    if (!body) throw new ToilError('INVALID_INPUT', `${name} has no "${input.response}" response.`, { fix: all.length ? `Its responses are: ${all.map((r) => r.status).join(', ')}.` : 'It lists no responses.' });
  }
  if (input.contentType !== undefined && !body.contentTypes.includes(input.contentType)) {
    throw new ToilError('INVALID_INPUT', `${name} doesn't list content type "${input.contentType}" for that body.`, { fix: body.contentTypes.length ? `It lists: ${body.contentTypes.join(', ')}.` : 'It lists no content types.' });
  }
  if (body.schemaPointer === null && !body.formSchema) {
    throw new ToilError('INVALID_INPUT', `${name}'s ${direction === 'request' ? 'request body' : `"${input.response}" response`} has no schema${body.contentType ? ` for ${body.contentType}` : ''}, so there's nothing to build an example from.`, {
      fix: body.contentTypes.length > 1 ? `Try another content type: ${body.contentTypes.join(', ')}.` : 'Pick another response, or another operation.',
    });
  }
  const schema = body.formSchema ?? atPointer(doc, body.schemaPointer!)!;
  const { example, truncated } = generateExample(doc, spec, schema, direction);
  // A cut-short example has nulls where values belong, so it can't be valid; validating 250,000 values to say so would only cost time.
  const check = truncated ? undefined : await checkExample(doc, spec, direction, example, body.formSchema ? { inline: body.formSchema } : { pointer: body.schemaPointer! });
  if (!check) {
    v.fail('example.valid', { at: '/', actual: `cut short at ${MAX_EXAMPLE_NODES} values or ${MAX_STRING} characters a string` }, {
      code: 'OPENAPI_EXAMPLE_TRUNCATED',
      message: `Building the example hit its limits (${MAX_EXAMPLE_NODES} values in all, ${MAX_STRING} characters a string), so it was cut short and not validated. Ask for a smaller body (another response or content type), or build that part by hand.`,
    });
  } else if (check.result) {
    if (check.result.valid) v.pass('example.valid');
    for (const p of check.result.problems) {
      v.fail('example.valid', { at: p.pointer || '/', actual: p.message }, { code: 'OPENAPI_EXAMPLE_INVALID', message: `The generated example fails its own schema at ${p.pointer || '/'}: ${p.message} It is returned as generated; fill that value in by hand.` });
    }
  } else v.unchecked('example.valid', check.unchecked!);
  return {
    document,
    operation: summarise(o),
    body: direction,
    status: direction === 'response' ? input.response! : null,
    contentType: body.contentType,
    schemaPointer: body.schemaPointer,
    example,
    verified: v.done(),
  };
}
