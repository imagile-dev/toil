import { ToilError } from '../../../core/errors.js';
import type { Verifier } from '../kit/verify.js';
import { atPointer, childPointer, DATA_KEYS, isObject, NAME_MAPS, refPointer, without, type Json, type JsonObject, type LoadedDocument, type Spec } from './document.js';

/**
 * The operations in an OpenAPI or Swagger document: listing them, and
 * laying one out the way a caller needs it, every parameter with where it
 * goes, the request body and each response, with `$ref`s expanded to a set
 * depth. Swagger 2.0's body and formData parameters become a request body,
 * so both versions come out in one shape. Each operation also says how to
 * send it through `toil <area> api`, which is why this command exists: an
 * agent that reads the contract before calling has one fewer reason to
 * file a ticket about the response.
 */

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace', 'query'] as const;
/** The methods `<area> api` sends. */
const API_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);

export interface Operation {
  method: string;
  path: string;
  /** Where the operation object is, as a JSON pointer. */
  pointer: string;
  op: JsonObject;
  pathItem: JsonObject;
  /** Where the path item is (its `$ref` target when it has one). */
  pathItemPointer: string;
}

/** A local `$ref`'s target, followed through chains of refs. Undefined when it doesn't resolve or the chain loops. */
export function follow(doc: Json, node: Json | undefined, pointer: string): { node: Json; pointer: string } | undefined {
  const seen = new Set<string>();
  let at = pointer;
  let current = node;
  while (isObject(current) && typeof current.$ref === 'string') {
    const target = refPointer(current.$ref);
    if (target === undefined || seen.has(target)) return undefined;
    seen.add(target);
    at = target;
    current = atPointer(doc, target);
  }
  return current === undefined ? undefined : { node: current, pointer: at };
}

/** Every operation in `paths`, in document order. A path item that is a `$ref` is followed. */
export function operations(doc: JsonObject): Operation[] {
  const out: Operation[] = [];
  if (!isObject(doc.paths)) return out;
  for (const [path, raw] of Object.entries(doc.paths)) {
    if (path.startsWith('x-')) continue;
    const item = follow(doc, raw, childPointer('/paths', path));
    if (!item || !isObject(item.node)) continue;
    const pathItem = item.node;
    for (const method of METHODS) {
      const op = pathItem[method];
      if (isObject(op)) out.push({ method: method.toUpperCase(), path, pointer: childPointer(item.pointer, method), op, pathItem, pathItemPointer: item.pointer });
    }
    // OpenAPI 3.2's other methods, by their own name.
    if (isObject(pathItem.additionalOperations)) {
      for (const [method, op] of Object.entries(pathItem.additionalOperations)) {
        if (isObject(op)) out.push({ method: method.toUpperCase(), path, pointer: childPointer(childPointer(item.pointer, 'additionalOperations'), method), op, pathItem, pathItemPointer: item.pointer });
      }
    }
  }
  return out;
}

const strings = (value: Json | undefined) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);
const text = (value: Json | undefined) => (typeof value === 'string' ? value : null);

export interface OperationSummary {
  method: string;
  path: string;
  operationId: string | null;
  summary: string | null;
  tags: string[];
  deprecated: boolean;
}

export const summarise = (o: Operation): OperationSummary => ({
  method: o.method,
  path: o.path,
  operationId: text(o.op.operationId),
  summary: text(o.op.summary),
  tags: strings(o.op.tags),
  deprecated: o.op.deprecated === true,
});

/** Document-wide checks on the operations: operationIds are unique, and every `{name}` in a path is declared as a path parameter. */
export function checkOperations(doc: JsonObject, ops: Operation[], v: Verifier): void {
  const ids = new Map<string, Operation>();
  for (const o of ops) {
    const id = text(o.op.operationId);
    if (id === null) continue;
    const first = ids.get(id);
    v.expect('operations.uniqueIds', first === undefined, { at: o.pointer, expected: `operationId "${id}" used once`, actual: first ? `also at ${first.pointer}` : undefined }, { code: 'OPENAPI_DUPLICATE_OPERATION_ID' });
    if (!first) ids.set(id, o);
  }
  if (ids.size === 0) v.unchecked('operations.uniqueIds', 'no operation has an operationId');
  for (const o of ops) {
    const declared = new Set(parameters(doc, o).filter((p) => p.in === 'path').map((p) => p.name));
    for (const [, name] of o.path.matchAll(/\{([^}]+)\}/g)) {
      v.expect('operations.pathParameters', declared.has(name!), { at: o.pointer, expected: `a path parameter named "${name}"`, actual: 'none declared' }, { code: 'OPENAPI_PATH_PARAMETER_MISSING' });
    }
  }
}

interface RawParameter {
  name: string;
  in: string;
  node: JsonObject;
  pointer: string;
}

/** The parameters that apply to an operation: the path item's, overridden by the operation's own on name and location. */
function parameters(doc: Json, o: Operation): RawParameter[] {
  const merged = new Map<string, RawParameter>();
  const add = (list: Json | undefined, pointer: string) => {
    if (!Array.isArray(list)) return;
    list.forEach((raw, i) => {
      const found = follow(doc, raw, childPointer(pointer, i));
      if (!found || !isObject(found.node) || typeof found.node.name !== 'string' || typeof found.node.in !== 'string') return;
      merged.set(`${found.node.in}\u0000${found.node.name}`, { name: found.node.name, in: found.node.in, node: found.node, pointer: found.pointer });
    });
  };
  add(o.pathItem.parameters, childPointer(o.pathItemPointer, 'parameters'));
  add(o.op.parameters, childPointer(o.pointer, 'parameters'));
  return [...merged.values()];
}

/**
 * The most objects and arrays one `show` builds while expanding. Refs fan
 * out, and each copies its whole target: a schema whose three properties each
 * refer to the next one, twenty deep, is 3^20 copies, which would hold the MCP
 * server until the heat death of the change board. Counting nodes rather than
 * refs also bounds a fan-out of wide schemas.
 */
export const MAX_NODES = 250_000;
/**
 * The most characters one `show` copies into its schemas, serialised. Nodes
 * alone don't bound it: a description, an `example` or an `enum` is copied
 * whole wherever its schema is expanded, and can be any size.
 */
export const MAX_CHARS = 4_000_000;

/** How far to expand, and what expansion left as a `$ref`. */
export interface Expansion {
  depth: number;
  /** `$ref`s left in place, by why: the depth was reached, the ref loops back on itself, it points outside the document, or at nothing. */
  stopped: { depth: number; circular: number; external: number; broken: number };
  /** How many `$ref`s were expanded. */
  expanded: number;
  /** How many objects and arrays expansion built, held near {@link MAX_NODES}. */
  nodes: number;
  /** Characters copied so far, against {@link MAX_CHARS}. */
  chars: number;
  /** Set when a budget ran out: every ref after that was left in place, counted under `stopped.depth`, and every other value is null. */
  truncated: boolean;
}

/**
 * A copy of `node` with its `$ref`s replaced by what they point at, up to
 * `depth` refs deep along any branch. A ref that is kept says why in
 * `x-toil-stop`; one that was expanded says where it came from in
 * `x-toil-ref`. In 3.0 and Swagger 2.0 a ref's siblings are ignored, as the
 * spec says; from 3.1 they're kept, over the target's keys.
 */
export function expand(doc: Json, spec: Spec, node: Json, expansion: Expansion, trail: string[] = [], names = false): Json {
  // Every value copied into the output is paid for here, at its serialised length; past the budget it's null.
  // The budget is checked before the cost is worked out, so a spent budget never serialises anything.
  const spend = (cost: () => number) => {
    if (expansion.chars > MAX_CHARS) {
      expansion.truncated = true;
      return false;
    }
    expansion.chars += cost();
    return true;
  };
  if (Array.isArray(node)) {
    if (!spend(() => 2 + node.length)) return null;
    expansion.nodes++;
    return node.map((child) => expand(doc, spec, child, expansion, trail));
  }
  if (!isObject(node)) return spend(() => JSON.stringify(node).length) ? node : null;
  if (!names && typeof node.$ref === 'string') {
    const ref = node.$ref;
    const target = refPointer(ref);
    const stop = (why: keyof Expansion['stopped']) => {
      expansion.stopped[why]++;
      return { $ref: ref, 'x-toil-stop': why };
    };
    if (target === undefined) return stop('external');
    if (trail.includes(target)) return stop('circular');
    if (trail.length >= expansion.depth) return stop('depth');
    if (expansion.nodes >= MAX_NODES || expansion.chars > MAX_CHARS) {
      expansion.truncated = true;
      return stop('depth');
    }
    const value = atPointer(doc, target);
    if (value === undefined) return stop('broken');
    expansion.expanded++;
    const expanded = expand(doc, spec, value, expansion, [...trail, target]);
    const siblings = without(node, '$ref');
    const keep = spec === 'openapi-3.1' || spec === 'openapi-3.2' ? expand(doc, spec, siblings, expansion, trail) : {};
    return isObject(expanded) ? { ...expanded, ...(keep as JsonObject), 'x-toil-ref': ref } : expanded;
  }
  if (!spend(() => 2)) return null;
  expansion.nodes++;
  const out: JsonObject = {};
  for (const [key, child] of Object.entries(node)) {
    // Examples, defaults and extensions are data, copied as written; under `properties` every key is a name.
    const data = !names && (DATA_KEYS.has(key) || key === 'examples' || key.startsWith('x-'));
    if (data) out[key] = spend(() => JSON.stringify(key).length + 2 + JSON.stringify(child).length) ? child : null;
    else out[key] = spend(() => JSON.stringify(key).length + 2) ? expand(doc, spec, child, expansion, trail, !names && NAME_MAPS.has(key)) : null;
  }
  return out;
}

export interface Parameter {
  name: string;
  in: string;
  required: boolean;
  description: string | null;
  deprecated: boolean;
  schema: Json | null;
  /** Where the parameter is defined, as a JSON pointer. */
  pointer: string;
}

export interface Body {
  required: boolean;
  description: string | null;
  /** Every content type the operation lists. */
  contentTypes: string[];
  /** The one `schema` is for: the first JSON type listed, else the first. */
  contentType: string | null;
  schema: Json | null;
  /** Where the unexpanded schema is, as a JSON pointer: what `util openapi example` validates against. */
  schemaPointer: string | null;
}

export interface Response extends Omit<Body, 'required'> {
  status: string;
}

/** The content type a body is shown for: JSON first, since that's what `<area> api` sends by default. */
export const preferredType = (types: string[]): string | null => types.find((t) => /^application\/(.+\+)?json\b/i.test(t)) ?? types.find((t) => /json/i.test(t)) ?? types[0] ?? null;

/** A body as found, before expansion: the schema's location and the content types. */
export interface RawBody {
  required: boolean;
  description: string | null;
  contentTypes: string[];
  contentType: string | null;
  /** Where the schema is; null for Swagger formData, whose schema is `formSchema`, built from the parameters. */
  schemaPointer: string | null;
  formSchema?: JsonObject;
}

/** OpenAPI 3.x content map -> types plus the preferred type's schema location. */
function fromContent(content: Json | undefined, pointer: string, choose?: string): Pick<RawBody, 'contentTypes' | 'contentType' | 'schemaPointer'> {
  const types = isObject(content) ? Object.keys(content) : [];
  const contentType = choose ?? preferredType(types);
  const media = contentType !== null && isObject(content) ? content[contentType] : undefined;
  const schemaPointer = isObject(media) && media.schema !== undefined ? childPointer(childPointer(childPointer(pointer, 'content'), contentType!), 'schema') : null;
  return { contentTypes: types, contentType, schemaPointer };
}

/** Swagger 2.0's `consumes` or `produces`: the operation's, else the document's. */
const swaggerTypes = (doc: JsonObject, op: JsonObject, key: 'consumes' | 'produces') => strings(op[key] ?? doc[key]);

/** The schema a Swagger 2.0 non-body parameter describes inline (type, format, items, enum, bounds). */
function swaggerParameterSchema(node: JsonObject): JsonObject {
  return without(node, 'name', 'in', 'description', 'required', 'allowEmptyValue', 'collectionFormat');
}

export function requestBody(doc: JsonObject, spec: Spec, o: Operation, contentType?: string): RawBody | null {
  if (spec === 'swagger-2.0') {
    const params = parameters(doc, o);
    const body = params.find((p) => p.in === 'body');
    const consumes = swaggerTypes(doc, o.op, 'consumes');
    if (body) {
      const types = consumes.length ? consumes : ['application/json'];
      return { required: body.node.required === true, description: text(body.node.description), contentTypes: types, contentType: contentType ?? preferredType(types), schemaPointer: body.node.schema === undefined ? null : childPointer(body.pointer, 'schema') };
    }
    const form = params.filter((p) => p.in === 'formData');
    if (!form.length) return null;
    const types = consumes.length ? consumes : ['application/x-www-form-urlencoded'];
    const required = form.filter((p) => p.node.required === true).map((p) => p.name);
    const formSchema: JsonObject = { type: 'object', properties: Object.fromEntries(form.map((p) => [p.name, swaggerParameterSchema(p.node)])), ...(required.length ? { required } : {}) };
    return { required: required.length > 0, description: null, contentTypes: types, contentType: contentType ?? types[0] ?? null, schemaPointer: null, formSchema };
  }
  const found = follow(doc, o.op.requestBody, childPointer(o.pointer, 'requestBody'));
  if (!found || !isObject(found.node)) return null;
  return { required: found.node.required === true, description: text(found.node.description), ...fromContent(found.node.content, found.pointer, contentType) };
}

/** The responses, by status, in document order. */
export function responses(doc: JsonObject, spec: Spec, o: Operation, contentType?: string): Array<RawBody & { status: string }> {
  const out: Array<RawBody & { status: string }> = [];
  if (!isObject(o.op.responses)) return out;
  for (const [status, raw] of Object.entries(o.op.responses)) {
    if (status.startsWith('x-')) continue;
    const found = follow(doc, raw, childPointer(childPointer(o.pointer, 'responses'), status));
    if (!found || !isObject(found.node)) continue;
    const description = text(found.node.description);
    if (spec === 'swagger-2.0') {
      const produces = swaggerTypes(doc, o.op, 'produces');
      const types = produces.length ? produces : ['application/json'];
      const has = found.node.schema !== undefined;
      out.push({ status, required: false, description, contentTypes: has ? types : [], contentType: has ? (contentType ?? preferredType(types)) : null, schemaPointer: has ? childPointer(found.pointer, 'schema') : null });
    } else out.push({ status, required: false, description, ...fromContent(found.node.content, found.pointer, contentType) });
  }
  return out;
}

/** The first server's path (`https://api.imagile.dev/v2` -> `/v2`), with its variables at their defaults; for Swagger, `basePath`. */
export function basePath(doc: JsonObject, spec: Spec, o: Operation): string {
  if (spec === 'swagger-2.0') return typeof doc.basePath === 'string' ? doc.basePath.replace(/\/+$/, '') : '';
  const servers = [o.op.servers, o.pathItem.servers, doc.servers].find((s) => Array.isArray(s) && s.length) as Json[] | undefined;
  const server = servers?.[0];
  if (!isObject(server) || typeof server.url !== 'string') return '';
  const variables = isObject(server.variables) ? server.variables : {};
  const url = server.url.replace(/\{([^}]+)\}/g, (whole, name: string) => {
    const variable = variables[name];
    return isObject(variable) && typeof variable.default === 'string' ? variable.default : whole;
  });
  const path = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '') : url.startsWith('/') ? url : `/${url}`;
  return path.replace(/\/+$/, '');
}

/** How to send the operation with `toil <area> api` (MCP `<area>_api`): its inputs, and the CLI line. */
export interface ApiCall {
  method: string;
  /** The server's base path plus the operation's path, with `{name}` for each path parameter to fill in. */
  path: string;
  pathParameters: string[];
  /** The required query parameters, as `name=<name>`. */
  query: string[];
  /** Set when the operation has a request body: the file to put it in. */
  bodyFile: string | null;
  /** Set when the body's type isn't `application/json`, the passthrough's default. */
  contentType: string | null;
  /** Whether the method is a write, which needs `--allow-write` and writes on the connection. */
  writes: boolean;
  /** Required header and cookie parameters, which `<area> api` doesn't send. */
  unsupported: string[];
  cli: string;
}

export interface ShownOperation {
  operation: OperationSummary & { description: string | null; pointer: string };
  parameters: Parameter[];
  requestBody: Body | null;
  responses: Response[];
  /** Null when the method is one `<area> api` doesn't send (OPTIONS, TRACE, QUERY). */
  call: ApiCall | null;
  expansion: Expansion;
}

export function apiCall(doc: JsonObject, spec: Spec, o: Operation, params: Parameter[], body: RawBody | null): ApiCall | null {
  if (!API_METHODS.has(o.method)) return null;
  const path = `${basePath(doc, spec, o)}${o.path}`;
  const query = params.filter((p) => p.in === 'query' && p.required).map((p) => `${p.name}=<${p.name}>`);
  const contentType = body && body.contentType && !/^application\/json\b/i.test(body.contentType) ? body.contentType : null;
  const writes = !['GET', 'HEAD'].includes(o.method);
  const quote = (value: string) => (/^[\w./{}<>=:-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`);
  const cli = [
    'toil <area> api',
    o.method,
    quote(path),
    ...query.map((q) => `--query ${quote(q)}`),
    ...(body ? ['--body-file body.json'] : []),
    ...(contentType ? [`--content-type ${quote(contentType)}`] : []),
    ...(writes ? ['--allow-write'] : []),
  ].join(' ');
  return {
    method: o.method,
    path,
    pathParameters: params.filter((p) => p.in === 'path').map((p) => p.name),
    query,
    bodyFile: body ? 'body.json' : null,
    contentType,
    writes,
    unsupported: params.filter((p) => p.required && (p.in === 'header' || p.in === 'cookie')).map((p) => `${p.in} ${p.name}`),
    cli,
  };
}

/** One operation, laid out with its refs expanded `depth` deep. */
export function showOperation(loaded: LoadedDocument, o: Operation, depth: number): ShownOperation {
  const { doc, spec } = loaded;
  const expansion: Expansion = { depth, stopped: { depth: 0, circular: 0, external: 0, broken: 0 }, expanded: 0, nodes: 0, chars: 0, truncated: false };
  const schemaAt = (pointer: string | null) => (pointer === null ? null : expand(doc, spec, atPointer(doc, pointer) ?? null, expansion));
  const params: Parameter[] = parameters(doc, o)
    .filter((p) => spec !== 'swagger-2.0' || (p.in !== 'body' && p.in !== 'formData'))
    .map((p) => {
      let schema: Json | null = null;
      if (spec === 'swagger-2.0') schema = expand(doc, spec, swaggerParameterSchema(p.node), expansion);
      else if (p.node.schema !== undefined) schema = schemaAt(childPointer(p.pointer, 'schema'));
      else if (isObject(p.node.content)) schema = schemaAt(fromContent(p.node.content, p.pointer).schemaPointer);
      return { name: p.name, in: p.in, required: p.in === 'path' || p.node.required === true, description: text(p.node.description), deprecated: p.node.deprecated === true, schema, pointer: p.pointer };
    });
  const raw = requestBody(doc, spec, o);
  const shownBody = (b: RawBody): Omit<Body, 'required'> => ({
    description: b.description,
    contentTypes: b.contentTypes,
    contentType: b.contentType,
    schema: b.formSchema ? expand(doc, spec, b.formSchema, expansion) : schemaAt(b.schemaPointer),
    schemaPointer: b.schemaPointer,
  });
  return {
    operation: { ...summarise(o), description: text(o.op.description), pointer: o.pointer },
    parameters: params,
    requestBody: raw ? { required: raw.required, ...shownBody(raw) } : null,
    responses: responses(doc, spec, o).map((r) => ({ status: r.status, ...shownBody(r) })),
    call: apiCall(doc, spec, o, params, raw),
    expansion,
  };
}

/**
 * The one operation a call names: by operationId, or by method and path.
 * Not found is INVALID_INPUT naming close matches, never a guess at one.
 */
export function findOperation(ops: Operation[], by: { operation?: string | undefined; method?: string | undefined; path?: string | undefined }): Operation {
  if (by.operation !== undefined && (by.method !== undefined || by.path !== undefined)) {
    throw new ToilError('INVALID_INPUT', 'Name the operation by operation, or by method and path, not both.', { fix: 'Pass --operation <operationId> on its own, or --method and --path.' });
  }
  if (by.operation !== undefined) {
    const matches = ops.filter((o) => o.op.operationId === by.operation);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new ToilError('INVALID_INPUT', `operationId "${by.operation}" is used by ${matches.length} operations.`, { fix: `Name it by method and path instead: ${matches.map((o) => `${o.method} ${o.path}`).join(', ')}.` });
    }
    const wanted = by.operation.toLowerCase();
    const close = ops.map((o) => text(o.op.operationId)).filter((id): id is string => id !== null && id.toLowerCase().includes(wanted)).slice(0, 10);
    throw new ToilError('INVALID_INPUT', `No operation has operationId "${by.operation}".`, {
      fix: close.length ? `Did you mean one of: ${close.join(', ')}? util openapi list shows them all.` : 'Run util openapi list to see the operations and their operationIds.',
    });
  }
  if (by.method === undefined || by.path === undefined) {
    throw new ToilError('INVALID_INPUT', 'Name the operation: pass operation (its operationId), or both method and path.', { fix: 'Run util openapi list to see the operations, then pass --operation <operationId>, or --method GET --path /the/path.' });
  }
  const method = by.method.toUpperCase();
  // A leading slash may be left off: Git Bash on Windows rewrites /repos/... into a file path.
  const path = by.path.startsWith('/') ? by.path : `/${by.path}`;
  const found = ops.find((o) => o.method === method && o.path === path);
  if (found) return found;
  const onPath = ops.filter((o) => o.path === path).map((o) => o.method);
  throw new ToilError('INVALID_INPUT', `No ${method} operation on path "${path}".`, {
    fix: onPath.length ? `That path has ${onPath.join(', ')}.` : 'The path must match the document exactly, placeholders included (/issue/{issueIdOrKey}). Run util openapi list --path <part> to find it.',
  });
}
