import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// The server's tests run in Node's environment (no window); the views' in jsdom.
afterEach(() => {
  if (typeof window === 'undefined') return;
  cleanup();
  window.location.hash = '';
});
