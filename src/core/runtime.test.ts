import { describe, expect, it } from 'vitest';
import { nodeRefused, unsupportedNode } from './runtime.js';

describe('the Node floor (CVE-2026-111497, #479)', () => {
  it('refuses every 24.x before 24.22.1 and accepts it and later, with or without a v', () => {
    expect(nodeRefused('v24.14.0')).toBe(true);
    expect(nodeRefused('24.22.0')).toBe(true);
    expect(nodeRefused('24.22.1')).toBe(false);
    expect(nodeRefused('v24.22.2')).toBe(false);
    expect(nodeRefused('24.100.0')).toBe(false);
  });

  it('refuses every 25.x, which gets no fix', () => {
    expect(nodeRefused('25.0.0')).toBe(true);
    expect(nodeRefused('25.99.99')).toBe(true);
  });

  it('refuses 26.x before 26.12.1 and accepts it and later', () => {
    expect(nodeRefused('26.0.0')).toBe(true);
    expect(nodeRefused('26.12.0')).toBe(true);
    expect(nodeRefused('26.12.1')).toBe(false);
    expect(nodeRefused('26.13.0')).toBe(false);
  });

  it('refuses any line older than 24, even one with its own fix, and allows a line newer than 26', () => {
    expect(nodeRefused('22.23.4')).toBe(true);
    expect(nodeRefused('20.0.0')).toBe(true);
    expect(nodeRefused('27.0.0')).toBe(false);
    expect(nodeRefused('28.1.0')).toBe(false);
  });

  it('a refused Node is one plain envelope error naming the CVE and the releases to install; a patched one gets nothing', () => {
    expect(unsupportedNode('v24.22.0', '0.0.0-test')).toEqual({
      ok: false,
      data: null,
      error: {
        code: 'UNSUPPORTED_NODE',
        message:
          "toil needs Node 24.22.1 or later on 24.x, or 26.12.1 or later, the releases that fix CVE-2026-111497 (a remote code execution in Node's Brotli decoder); this is 24.22.0.",
        fix: "Install Node 24.22.1 or later on 24.x, or 26.12.1 or later (nodejs.org, or your organization's approved channel), then run toil again. Node 25 gets no fix.",
      },
      meta: { command: 'toil', durationMs: 0, version: '0.0.0-test', contractVersion: 1 },
    });
    expect(unsupportedNode('25.1.0', '0.0.0-test')?.error?.message).toContain('this is 25.1.0.');
    expect(unsupportedNode('24.22.1', '0.0.0-test')).toBeUndefined();
    expect(unsupportedNode('26.12.1', '0.0.0-test')).toBeUndefined();
  });
});
