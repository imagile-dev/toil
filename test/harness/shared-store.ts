import { fakeStore } from './fake-store.js';

/**
 * One in-memory credential store for a test file that mocks
 * `createSecretStore` (src/core/keychain.ts), which the API calls itself:
 * the mock returns this, and the test reads and clears it.
 */
export const sharedStore = fakeStore();
