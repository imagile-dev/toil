import { describe, expect, it } from 'vitest';
import { JsonSyntaxError, parseStrictJson } from './strict-json.js';

describe('parseStrictJson', () => {
  it('reads what JSON.parse reads, byte-order mark included', () => {
    const text = '﻿{"a": [1, -2.5e3, true, false, null, "x\\n\\u00e9\\"/"], "b": {}, "c": []}';
    expect(parseStrictJson(text)).toEqual({ value: JSON.parse(text.slice(1)), duplicates: [] });
  });

  it('reports a key given twice by its path, nested and in arrays, keeping the last as JSON.parse does', () => {
    const text = '{"jira": {"fields": {"storyPoints": "a", "storyPoints": "b"}}, "repos": [{"name": "x"}, {"name": "y", "name": "z"}], "name": 1, "name": 2}';
    const { value, duplicates } = parseStrictJson(text);
    expect(duplicates).toEqual(['jira.fields.storyPoints', 'repos[1].name', 'name']);
    expect(value).toEqual(JSON.parse(text));
  });

  it('treats __proto__ as an ordinary key', () => {
    const { value } = parseStrictJson('{"__proto__": {"polluted": true}}');
    expect(Object.keys(value as object)).toEqual(['__proto__']);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('says where a syntax error is, and never what was there', () => {
    for (const bad of ['{"token": "s3cret"', '{"a" 1}', '[1,]', '{"a": tru}', '"\u0001"', '{} x', '']) {
      let caught: unknown;
      try {
        parseStrictJson(bad);
      } catch (err) {
        caught = err;
      }
      expect(caught, bad).toBeInstanceOf(JsonSyntaxError);
      expect((caught as Error).message).toMatch(/at line \d+, column \d+$/);
      expect((caught as Error).message).not.toContain('s3cret');
    }
  });
});
