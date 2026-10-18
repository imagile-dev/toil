import { z } from 'zod';

type Def = { type: string; innerType?: z.ZodType; element?: z.ZodType; options?: readonly z.ZodType[] };
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

/**
 * The two shapes of a repeatable flag, so every area builds them the same way
 * and `flagRepeats` below is the one rule that reads them:
 *
 * - `repeatedFlag`: always a list (`github create-issue --label a --label b`);
 *   empty or absent means not given
 * - `oneOrMany`: one value, or a list when the flag is repeated (`jira
 *   get-issue --key A --key B`), for a command whose single form must keep its
 *   own input and output
 */
export const repeatedFlag = (description: string) => z.array(z.string()).optional().describe(description);
export const oneOrMany = (description: string) => z.union([z.string(), z.array(z.string())]).describe(description);

/**
 * How a field's flag repeats, if it does: an array field always collects a
 * list, and a union of one value or an array of them stays a single value when
 * the flag is given once and becomes the list when it's given again. `single`
 * says which; `element` is what each use is typed as.
 */
export function flagRepeats(schema: z.ZodType): { element: z.ZodType; single: boolean } | undefined {
  const inner = unwrap(schema);
  const def = defOf(inner);
  if (def.type === 'array' && def.element) return { element: def.element, single: false };
  if (def.type !== 'union' || def.options?.length !== 2) return undefined;
  const [a, b] = def.options.map(unwrap) as [z.ZodType, z.ZodType];
  const [one, many] = defOf(a).type === 'array' ? [b, a] : [a, b];
  const element = defOf(many).element;
  if (defOf(many).type !== 'array' || !element || defOf(one).type === 'array' || defOf(unwrap(element)).type !== defOf(one).type) return undefined;
  return { element: one, single: true };
}

/**
 * Text from argv or an env var, as the type the schema asks for. The one
 * place this happens, for every area and both sources:
 *
 * - number: plain decimal digits ("50", "-1.5"), never hex, exponents or
 *   padding; boolean: exactly "true" or "false"
 * - array or object: JSON (`[1,2]`, `{"a":1}`), as an env var or a single flag value
 * - anything else, a union included, stays text. Jira's `--max-results`
 *   accepts number or string on purpose, so `parseInt` keeps the reading
 *   of "10x" the contract specifies.
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
