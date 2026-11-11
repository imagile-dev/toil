/**
 * How toil reads a boolean out of an environment variable, in one place so the
 * write gate, a connection's flags and toil's own switches never disagree.
 *
 * `1` and `true` are on, `0` and `false` are off, case and surrounding spaces
 * ignored. Anything else is `undefined`: never guessed, because a write gate
 * that guesses is a write gate in name only. Argv has its own, stricter rule
 * (`fromText`), and a JSON config file holds real booleans.
 * Each variant of "yes" was considered by a working group; the minutes are
 * with the working group.
 */
export function envBoolean(text: string | undefined): boolean | undefined {
  const word = text?.trim().toLowerCase();
  if (word === 'true' || word === '1') return true;
  if (word === 'false' || word === '0') return false;
  return undefined;
}

/**
 * A presence switch (TOIL_REDUCED_MOTION, TOIL_ASCII): any non-empty value has
 * always meant on, and still does, except that a value that reads as off (`0`,
 * `false`) now means off.
 */
export function envSwitch(text: string | undefined): boolean {
  return envBoolean(text) ?? Boolean(text);
}
