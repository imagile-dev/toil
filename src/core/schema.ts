import type { z } from 'zod';

/**
 * What a zod field is underneath its optional/default/nullable wrappers:
 * 'string', 'number', 'boolean', 'array', 'object' and so on. Core uses it to
 * turn text from argv and env (which only ever hold strings) into the type a
 * schema asked for, so no area writes its own parser for "50" or "true".
 * Form 27B/6 asks for a number; the box on it only accepts text.
 */
export function baseType(schema: z.ZodType): string {
  let def = (schema as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
  while ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable' || def.type === 'prefault') && def.innerType) {
    def = (def.innerType as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
  }
  return def.type;
}

/** The field schema for `field` on an object schema, if it has one. */
export function fieldSchema(schema: z.ZodObject, field: string): z.ZodType | undefined {
  return (schema.shape as Record<string, z.ZodType>)[field];
}
