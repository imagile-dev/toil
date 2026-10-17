import type { z } from 'zod';

type Def = { type: string; innerType?: z.ZodType; element?: z.ZodType };
const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/** The schema underneath optional/default/nullable wrappers. */
function unwrap(schema: z.ZodType): z.ZodType {
  let at = schema;
  let def = defOf(at);
  while ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable' || def.type === 'prefault') && def.innerType) {
    at = def.innerType;
    def = defOf(at);
  }
  return at;
}

/**
 * What a zod field is underneath its optional/default/nullable wrappers:
 * 'string', 'number', 'boolean', 'array', 'object' and so on. Core uses it to
 * turn text from argv and env (which only ever hold strings) into the type a
 * schema asked for, so no area writes its own parser for "50" or "true".
 * Form 27B/6 asks for a number; the box on it only accepts text.
 */
export function baseType(schema: z.ZodType): string {
  return defOf(unwrap(schema)).type;
}

/** The field schema for `field` on an object schema, if it has one. */
export function fieldSchema(schema: z.ZodObject, field: string): z.ZodType | undefined {
  return (schema.shape as Record<string, z.ZodType>)[field];
}

/** An array field's element schema. */
export function elementSchema(schema: z.ZodType): z.ZodType | undefined {
  const inner = unwrap(schema);
  return defOf(inner).type === 'array' ? defOf(inner).element : undefined;
}

/**
 * Text from argv or an env var, as the type the schema asks for. The one
 * place this happens, for every area and both sources:
 *
 * - number: plain decimal digits ("50", "-1.5"), never hex, exponents or
 *   padding; boolean: exactly "true" or "false"
 * - array or object: JSON (`[1,2]`, `{"a":1}`), as an env var or a single flag value
 * - anything else, a union included, stays text. Jira's `--max-results`
 *   accepts number or string on purpose, so `parseInt` keeps the predecessor's
 *   reading of "10x".
 *
 * Text that doesn't parse is left alone, so the schema rejects it with the
 * same message through both front doors.
 */
export function fromText(schema: z.ZodType, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const type = baseType(schema);
  if (type === 'number' && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true';
  if (type === 'array' || type === 'object' || type === 'record') {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return value;
    }
  }
  return value;
}
