import { Validator } from '@cfworker/json-schema';
import { describe, expect, it } from 'vitest';
import schema from '../../docs/owi/schema.json';
import { FIXTURE_INFO, FIXTURE_ITEMS, fixtureStore } from '../src/fixtures/store.ts';

/**
 * The fixture Store serves the CLI's own sprint fixture, read in place, and
 * every item it serves is a valid OWI record under the published schema.
 */

describe('the fixture Store', () => {
  it('serves twenty items that validate against docs/owi/schema.json', () => {
    const validator = new Validator(schema as object, '2020-12', false);
    expect(FIXTURE_ITEMS).toHaveLength(20);
    for (const item of FIXTURE_ITEMS) {
      const result = validator.validate(item);
      expect(result.errors.map((e) => `${e.instanceLocation} ${e.error}`), item.id).toEqual([]);
    }
  });

  it('looks items up by id and says when one is missing', async () => {
    const store = fixtureStore();
    expect((await store.item('corp-ado:2302'))?.title).toBe('Export the daily settlement CSV');
    expect(await store.item('corp-ado:9999')).toBeNull();
    expect(await store.info()).toBe(FIXTURE_INFO);
  });

  it('names only placeholder hosts', async () => {
    const store = fixtureStore();
    const urls = [...(await store.items()).map((i) => i.url), ...(await store.changes()).map((c) => c.url)].filter(Boolean) as string[];
    for (const url of urls) expect(new URL(url).hostname, url).toMatch(/\.imagile\.dev$/);
  });
});
