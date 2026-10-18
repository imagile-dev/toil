import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Vitest global setup: fails `npm test` when anything appended to the real
 * `~/.toil/audit/` while the suite ran. Tests give execute() a memory audit
 * log (`testContext`) or a temp home; one that reaches the real home is a bug,
 * since it puts test calls in a log a person reads as their own history. Using
 * toil by hand while the suite runs trips it too, which is the one false alarm
 * this accepts.
 */
const dir = join(homedir(), '.toil', 'audit');

/** The real audit log's files and their sizes; a test can compare two readings itself. */
export function sizes(): Map<string, number> {
  if (!existsSync(dir)) return new Map();
  return new Map(readdirSync(dir).map((name) => [name, statSync(join(dir, name)).size]));
}

export default function setup(): () => void {
  const before = sizes();
  return () => {
    const grown = [...sizes()].filter(([name, size]) => size !== (before.get(name) ?? -1));
    if (grown.length > 0) {
      // Vitest reports an error thrown here but still exits 0, so set the exit code too.
      process.exitCode = 1;
      throw new Error(`npm test wrote to the real audit log (${grown.map(([n]) => join(dir, n)).join(', ')}). Give the test that did a temp home or testContext()'s memory audit log.`);
    }
  };
}
