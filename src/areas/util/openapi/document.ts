import { ToilError } from '../../../core/errors.js';
import type { Schema, SchemaProblem } from '../kit/json-schema.js';
import type { UtilInput } from '../kit/input.js';
import type { Verifier } from '../kit/verify.js';

/**
 * Reading an OpenAPI or Swagger document and checking it: which version it
 * declares, whether it's valid against the official schema for that version
 * (bundled in ./schemas, never fetched), and whether every `$ref` in it
 * resolves. Circular references are found once, here, so nothing downstream
 * has to discover them by recursing until the stack gives out. Loaded only
 * when a `util openapi` command runs.
 *
 * The schemas are the OpenAPI Initiative's published ones, vendored as
 * published (Apache-2.0; NOTICE). A document that fails its schema is still
 * listed and shown, with every problem by JSON pointer: real vendor specs are
 * not always valid, and refusing them would help nobody. A specification
 * written to describe an API is itself subject to a specification, which is
 * how standards bodies keep their headcount.
 */

export type Spec = 'swagger-2.0' | 'openapi-3.0' | 'openapi-3.1' | 'openapi-3.2';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export interface LoadedDocument {
  doc: JsonObject;
  spec: Spec;
  /** The version the document declares (`3.0.1`, `2.0`). */
  version: string;
  format: 'json' | 'yaml';
}

/** A copy of an object without some keys. */
export const without = (node: JsonObject, ...keys: string[]): JsonObject => Object.fromEntries(Object.entries(node).filter(([k]) => !keys.includes(k)));

/**
 * A validator's message, cut to 300 characters: an `enum` failure quotes the
 * whole list, and a document's list can be any size.
 */
export const brief = (message: string) => (message.length > 300 ? `${message.slice(0, 300)}…` : message);

/** The deepest a document may nest: real API descriptions nest a few dozen levels, and everything after parsing recurses into it. */
export const MAX_DOCUMENT_DEPTH = 256;

/** How deep a parsed value nests, iteratively, stopping once past four times the limit. */
function nesting(value: unknown): number {
  let deepest = 0;
  const stack: Array<[unknown, number]> = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > deepest) deepest = depth;
    if (deepest > MAX_DOCUMENT_DEPTH * 4) return deepest;
    for (const child of Object.values(node)) if (typeof child === 'object' && child !== null) stack.push([child, depth + 1]);
  }
  return deepest;
}

export const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);

/** One JSON pointer token, escaped (`/` as `~1`, `~` as `~0`). */
export const escapeToken = (token: string) => token.replace(/~/g, '~0').replace(/\//g, '~1');
const unescapeToken = (token: string) => token.replace(/~1/g, '/').replace(/~0/g, '~');
export const childPointer = (pointer: string, token: string | number) => `${pointer}/${escapeToken(String(token))}`;

/** The value at a JSON pointer (`/paths/~1pets/get`), or undefined when there's nothing there. */
export function atPointer(doc: Json, pointer: string): Json | undefined {
  if (pointer === '') return doc;
  if (!pointer.startsWith('/')) return undefined;
  let node: Json | undefined = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const token = unescapeToken(raw);
    if (Array.isArray(node)) {
      if (!/^(0|[1-9]\d*)$/.test(token)) return undefined;
      node = node[Number(token)];
    } else if (isObject(node)) {
      node = Object.hasOwn(node, token) ? node[token] : undefined;
    } else return undefined;
    if (node === undefined) return undefined;
  }
  return node;
}

/** The JSON pointer a local `$ref` names (`#/components/schemas/Pet` -> `/components/schemas/Pet`), or undefined for one outside this document. */
export function refPointer(ref: string): string | undefined {
  if (!ref.startsWith('#')) return undefined;
  try {
    return decodeURIComponent(ref.slice(1));
  } catch {
    return ref.slice(1);
  }
}

/** The document's text as a value: JSON when it parses as JSON, else YAML through the kit, whose errors carry a line and column. */
export async function loadDocument(input: UtilInput): Promise<LoadedDocument> {
  const text = await input.text();
  let value: unknown;
  let format: 'json' | 'yaml' = 'yaml';
  if (/^\s*[{[]/.test(text)) {
    try {
      value = JSON.parse(text);
      format = 'json';
    } catch {
      // JSON.parse's message quotes the text around the error; YAML reads JSON too and says only where.
    }
  }
  if (format === 'yaml') {
    const { parseYaml } = await import('../kit/yaml.js');
    value = parseYaml(text, input.label);
  }
  const notADocument = (why: string) =>
    new ToilError('INVALID_INPUT', `${input.label[0]!.toUpperCase()}${input.label.slice(1)} isn't an OpenAPI or Swagger document: ${why}.`, {
      fix: 'Pass an OpenAPI 3.x or Swagger 2.0 document, in JSON or YAML, with an "openapi" or "swagger" field at the top.',
    });
  if (!isObject(value)) throw notADocument('it is not an object');
  const depth = nesting(value);
  if (depth > MAX_DOCUMENT_DEPTH) {
    throw new ToilError('INVALID_INPUT', `${input.label[0]!.toUpperCase()}${input.label.slice(1)} nests ${depth > MAX_DOCUMENT_DEPTH * 4 ? 'far ' : ''}more than ${MAX_DOCUMENT_DEPTH} levels deep, more than this command reads.`, {
      fix: 'Pass a document whose objects and arrays nest at most 256 levels deep. Real API descriptions nest a few dozen.',
    });
  }
  const declared = value.openapi ?? value.swagger;
  if (declared === undefined) throw notADocument('it has no "openapi" or "swagger" field');
  if (typeof declared !== 'string') throw notADocument(`its ${value.openapi !== undefined ? '"openapi"' : '"swagger"'} field is ${JSON.stringify(declared)}, not a version string such as "3.0.3"`);
  const spec: Spec | undefined =
    value.openapi === undefined
      ? declared === '2.0'
        ? 'swagger-2.0'
        : undefined
      : /^3\.0(\.|$)/.test(declared)
        ? 'openapi-3.0'
        : /^3\.1(\.|$)/.test(declared)
          ? 'openapi-3.1'
          : /^3\.2(\.|$)/.test(declared)
            ? 'openapi-3.2'
            : undefined;
  if (spec === undefined) {
    throw new ToilError('INVALID_INPUT', `${input.label[0]!.toUpperCase()}${input.label.slice(1)} declares ${value.openapi !== undefined ? 'OpenAPI' : 'Swagger'} ${declared}, which this command doesn't read.`, {
      fix: 'Pass a Swagger 2.0 or OpenAPI 3.0, 3.1 or 3.2 document.',
    });
  }
  return { doc: value, spec, version: declared, format };
}

/** The bundled schema for a version, with the draft-04 meta-schema Swagger 2.0's refers to. Loaded on first use. */
async function officialSchema(spec: Spec): Promise<{ schema: Schema; references: Array<{ schema: Schema }> }> {
  // The validator annotates the schema objects it's given, so each call gets its own copy.
  const own = (module: { default: unknown }) => structuredClone(module.default) as Schema;
  switch (spec) {
    case 'swagger-2.0':
      return {
        schema: own(await import('./schemas/swagger-2.0.json', { with: { type: 'json' } })),
        references: [{ schema: own(await import('./schemas/json-schema-draft-04.json', { with: { type: 'json' } })) }],
      };
    case 'openapi-3.0':
      return { schema: own(await import('./schemas/openapi-3.0.json', { with: { type: 'json' } })), references: [] };
    case 'openapi-3.1':
      return { schema: own(await import('./schemas/openapi-3.1.json', { with: { type: 'json' } })), references: [] };
    case 'openapi-3.2':
      return { schema: own(await import('./schemas/openapi-3.2.json', { with: { type: 'json' } })), references: [] };
  }
}

export interface RefIssue {
  /** Where the `$ref` is, as a JSON pointer. */
  at: string;
  ref: string;
}

export interface RefReport {
  /** Every `$ref` in the document. */
  total: number;
  /** Those pointing into this document, which were each resolved. */
  local: number;
  /** Local refs that point at nothing. */
  broken: RefIssue[];
  /** Refs to another file or a URL, which are not followed. */
  external: RefIssue[];
  /** Each group of targets that refer to one another in a loop, as refs (`#/components/schemas/Node`). */
  circular: string[][];
}

export interface DocumentReport {
  spec: Spec;
  version: string;
  format: 'json' | 'yaml';
  /** The `$id` of the schema the document was validated against. */
  schema: string;
  title: string | null;
  apiVersion: string | null;
  /** Null when the document couldn't be validated; `document.schema` in `verified` says why. */
  valid: boolean | null;
  /** What is wrong, by JSON pointer into the document, deepest first, at most 50: each problem where it starts, not every enclosing keyword that failed because of it. */
  problems: Array<Pick<SchemaProblem, 'pointer' | 'keyword' | 'message'>>;
  problemCount: number;
  refs: RefReport;
}

const MAX_LISTED = 50;

/**
 * Keys whose values are names, not keywords: under `properties`, a key called
 * `example` or `x-total` is a property, and its value is a schema to walk.
 */
export const NAME_MAPS = new Set([
  'properties', 'patternProperties', 'definitions', '$defs', 'dependentSchemas', 'paths', 'webhooks', 'responses', 'parameters', 'headers', 'content',
  'callbacks', 'links', 'encoding', 'securitySchemes', 'schemas', 'requestBodies', 'examples', 'pathItems', 'mediaTypes', 'variables', 'additionalOperations',
]);
/** Keys whose values are data (an example, a default), where a `$ref` key is just a key. */
export const DATA_KEYS = new Set(['example', 'default', 'enum', 'const', 'value', 'mapping']);

/**
 * Every `$ref` string in the document with where it sits, skipping data: an
 * example's value, a default, an enum, an extension (`x-*`), Swagger's
 * `examples` and a 3.1 schema's `examples` array.
 */
export function collectRefs(doc: Json, spec: Spec): RefIssue[] {
  const found: RefIssue[] = [];
  const stack: Array<{ node: Json; pointer: string; names: boolean }> = [{ node: doc, pointer: '', names: false }];
  while (stack.length) {
    const { node, pointer, names } = stack.pop()!;
    if (Array.isArray(node)) {
      node.forEach((child, i) => stack.push({ node: child, pointer: childPointer(pointer, i), names: false }));
      continue;
    }
    if (!isObject(node)) continue;
    if (!names && typeof node.$ref === 'string') found.push({ at: childPointer(pointer, '$ref'), ref: node.$ref });
    for (const [key, child] of Object.entries(node)) {
      if (!names) {
        if (key.startsWith('x-') || DATA_KEYS.has(key)) continue;
        if (key === 'examples' && (spec === 'swagger-2.0' || Array.isArray(child))) continue;
      }
      stack.push({ node: child, pointer: childPointer(pointer, key), names: !names && NAME_MAPS.has(key) });
    }
  }
  return found.reverse();
}

/**
 * The loops among local references: target A's subtree refers to B, and B's
 * back to A (or A to itself). Found with Tarjan's algorithm over the graph
 * of targets, iteratively, so a deep chain can't overflow the stack.
 */
function findCycles(refs: Array<RefIssue & { target: string }>): string[][] {
  const targets = new Set(refs.map((r) => r.target));
  const edges = new Map<string, Set<string>>();
  for (const { at, target } of refs) {
    // The targets enclosing this ref: every ancestor of where it sits that something refers to.
    let owner = at.slice(0, at.lastIndexOf('/'));
    for (;;) {
      if (targets.has(owner)) {
        let out = edges.get(owner);
        if (!out) edges.set(owner, (out = new Set()));
        out.add(target);
      }
      if (owner === '') break;
      owner = owner.slice(0, owner.lastIndexOf('/'));
    }
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let next = 0;
  for (const start of targets) {
    if (index.has(start)) continue;
    const work: Array<{ node: string; children: string[]; i: number }> = [];
    const visit = (node: string) => {
      index.set(node, next);
      low.set(node, next++);
      stack.push(node);
      onStack.add(node);
      work.push({ node, children: [...(edges.get(node) ?? [])], i: 0 });
    };
    visit(start);
    while (work.length) {
      const frame = work[work.length - 1]!;
      if (frame.i < frame.children.length) {
        const child = frame.children[frame.i++]!;
        if (!index.has(child)) visit(child);
        else if (onStack.has(child)) low.set(frame.node, Math.min(low.get(frame.node)!, index.get(child)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent.node, Math.min(low.get(parent.node)!, low.get(frame.node)!));
      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          group.push(member);
        } while (member !== frame.node);
        if (group.length > 1 || edges.get(frame.node)?.has(frame.node)) cycles.push(group.sort().map((p) => `#${p}`));
      }
    }
  }
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/** Checks every `$ref`: each local one must resolve, external ones are counted and reported unchecked, and loops are found. */
export function checkRefs(doc: Json, spec: Spec, v: Verifier): RefReport {
  const all = collectRefs(doc, spec);
  const local: Array<RefIssue & { target: string }> = [];
  const broken: RefIssue[] = [];
  const external: RefIssue[] = [];
  for (const issue of all) {
    const target = refPointer(issue.ref);
    if (target === undefined) {
      external.push(issue);
      continue;
    }
    const ok = atPointer(doc, target) !== undefined;
    v.expect('refs.resolve', ok, { at: issue.at, expected: `a value at ${issue.ref}`, actual: 'nothing there' }, { code: 'OPENAPI_REF_BROKEN', message: `The $ref at ${issue.at} points at nothing: ${issue.ref}.` });
    if (ok) local.push({ ...issue, target });
    else broken.push(issue);
  }
  if (local.length + broken.length === 0) v.unchecked('refs.resolve', 'the document has no local $ref');
  if (external.length) v.unchecked('refs.external', `${external.length} $ref${external.length === 1 ? ' points' : 's point'} outside this document (first at ${external[0]!.at}), and other files and URLs are not read`);
  return { total: all.length, local: local.length + broken.length, broken: broken.slice(0, MAX_LISTED), external: external.slice(0, MAX_LISTED), circular: findCycles(local).slice(0, MAX_LISTED) };
}

/** Validates the document against its version's official schema, and checks its references. */
export async function checkDocument(loaded: LoadedDocument, v: Verifier): Promise<DocumentReport> {
  const { leafProblems, validateSchema } = await import('../kit/json-schema.js');
  const { schema, references } = await officialSchema(loaded.spec);
  const result = validateSchema(schema, loaded.doc, { references, maxProblems: Infinity });
  const leaves = leafProblems(result.problems).map((p) => ({ ...p, message: brief(p.message) }));
  if (result.unchecked !== undefined) v.unchecked('document.schema', result.unchecked);
  else if (result.valid) v.pass('document.schema');
  const against = loaded.spec === 'swagger-2.0' ? 'Swagger 2.0' : `OpenAPI ${loaded.spec.slice(8)}`;
  for (const p of leaves) {
    v.fail('document.schema', { at: p.pointer || '/', actual: p.message }, { code: 'OPENAPI_INVALID', message: `The document fails the ${against} schema at ${p.pointer || '/'}: ${p.message}` });
  }
  if (loaded.spec === 'openapi-3.1' || loaded.spec === 'openapi-3.2') {
    // The 3.1 and 3.2 schemas hand Schema Objects to the JSON Schema dialect through $dynamicRef; that dialect check isn't made.
    v.unchecked('document.schemaObjects', `the OpenAPI ${loaded.spec.slice(8)} schema leaves Schema Objects to the JSON Schema 2020-12 dialect, which is not checked here`);
  }
  const refs = checkRefs(loaded.doc, loaded.spec, v);
  const info = isObject(loaded.doc.info) ? loaded.doc.info : {};
  return {
    spec: loaded.spec,
    version: loaded.version,
    format: loaded.format,
    schema: String((schema as { $id?: unknown; id?: unknown }).$id ?? (schema as { id?: unknown }).id),
    title: typeof info.title === 'string' ? info.title : null,
    apiVersion: typeof info.version === 'string' ? info.version : null,
    valid: result.unchecked !== undefined ? null : result.valid,
    problems: leaves.slice(0, MAX_LISTED).map(({ pointer, keyword, message }) => ({ pointer, keyword, message })),
    problemCount: leaves.length,
    refs,
  };
}
