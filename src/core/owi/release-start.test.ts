import { describe, expect, it } from 'vitest';
import { releasesOf } from './common.js';

describe('a release start day', () => {
  it('is the day Jira gives, null when the key is empty, and absent when the version never carried it', () => {
    const [a, b, c, d] = releasesOf([
      { id: '1', name: '2.4', released: false, releaseDate: '2026-11-21', startDate: '2026-10-06' },
      { id: '2', name: '2.5', startDate: '' },
      { id: '3', name: '2.6' },
      'bare',
    ]);
    expect(a).toMatchObject({ start: '2026-10-06', date: '2026-11-21' });
    expect(b!.start).toBeNull();
    expect('start' in c!).toBe(false);
    expect('start' in d!).toBe(false);
  });
});
