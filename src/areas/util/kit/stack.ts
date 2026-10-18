/**
 * Whether `err` is the stack running out, for the bounded worker
 * (kit/bounded-task.ts) and its host (kit/bounded.ts). Only V8's own message
 * says so: `Invalid string length` and `Invalid array length` are
 * RangeErrors too, from a result grown too big, and calling those "nests too
 * deep" would send the user looking for nesting that isn't there. Not every
 * form marked urgent is about the deadline.
 */
export function outOfStack(err: unknown): boolean {
  return err instanceof RangeError && /Maximum call stack size exceeded/.test(err.message);
}
