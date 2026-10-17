import type { SecretStore } from '../../src/core/keychain.js';

export interface FakeStore extends SecretStore {
  entries: Map<string, string>;
  /** Every operation in order, e.g. `set corp-jira.token`. Secrets are never recorded. */
  log: string[];
}

/**
 * An in-memory credential store. Tests use it in place of the OS one, so no
 * test ever reads or writes a real keychain. `fail` makes every call throw,
 * as a store that isn't installed would; `onDelete` lets a test check what
 * config said at the moment an old secret was removed.
 */
export function fakeStore(options: { entries?: Record<string, string>; fail?: Error; onDelete?: (ref: string) => void } = {}): FakeStore {
  const entries = new Map(Object.entries(options.entries ?? {}));
  const log: string[] = [];
  const check = () => {
    if (options.fail) throw options.fail;
  };
  return {
    name: 'fake store',
    entries,
    log,
    get(ref) {
      log.push(`get ${ref}`);
      check();
      return entries.get(ref);
    },
    set(ref, secret) {
      log.push(`set ${ref}`);
      check();
      entries.set(ref, secret);
    },
    delete(ref) {
      log.push(`delete ${ref}`);
      check();
      options.onDelete?.(ref);
      return entries.delete(ref);
    },
  };
}
