import { describe, expect, it } from 'vitest';
import { nodeTooOld, unsupportedNode } from './runtime.js';

describe('the Node floor', () => {
  it('compares versions numerically, with or without a v', () => {
    expect(nodeTooOld('22.23.3')).toBe(true);
    expect(nodeTooOld('v24.13.9')).toBe(true);
    expect(nodeTooOld('24.14.0')).toBe(false);
    expect(nodeTooOld('24.100.0')).toBe(false);
    expect(nodeTooOld('26.12.0')).toBe(false);
  });

  it('below the floor is one plain envelope error; at or above it, nothing', () => {
    expect(unsupportedNode('v22.23.3', '0.0.0-test')).toEqual({
      ok: false,
      data: null,
      error: {
        code: 'UNSUPPORTED_NODE',
        message: 'toil needs Node 24.14 or later; this is 22.23.3.',
        fix: expect.stringContaining('Install Node 24.14 or later'),
      },
      meta: { command: 'toil', durationMs: 0, version: '0.0.0-test', contractVersion: 1 },
    });
    expect(unsupportedNode(process.versions.node, '0.0.0-test')).toBeUndefined();
  });
});
