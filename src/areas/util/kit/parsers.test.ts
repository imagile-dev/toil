import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { regexRisk } from './regex.js';
import { leafProblems, MAX_SCHEMA_FAN_OUT, schemaDraft, schemaFanOut, validateSchema, type Schema } from './json-schema.js';
import { MAX_YAML_NODES, parseYaml } from './yaml.js';

/** An OpenAPI 3.0 fragment in YAML, the way vendors publish them, with a placeholder server. */
const OPENAPI_YAML = `openapi: 3.0.3
info:
  title: Orders
  version: "1.0"
servers:
  - url: https://api.imagile.dev/v1
paths:
  /orders/{id}:
    get:
      operationId: getOrder
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: The order
          content:
            application/json:
              example: { id: abc12345, placed: 2026-01-01, total: 12.50, paid: true, note: null }
`;

describe('parseYaml', () => {
  it("refuses alias fan-out past the node limit, the reviewer's seven-level document included, and keeps ordinary aliases", () => {
    const levels = ['a0: &a0 ["lol"]'];
    for (let i = 1; i <= 6; i++) levels.push(`a${i}: &a${i} [${Array(10).fill(`*a${i - 1}`).join(', ')}]`);
    const laughs = levels.join('\n');
    expect(laughs.length).toBeLessThan(400);
    const started = performance.now();
    expect(() => parseYaml(laughs, 'the file "laughs.yaml"')).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: `The file "laughs.yaml" uses aliases that add more than ${MAX_YAML_NODES} values to it once expanded, the most toil accepts.` }),
    );
    expect(performance.now() - started).toBeLessThan(2000);
    expect(parseYaml('base: &b { type: string }\nuse: [*b, *b]')).toEqual({ base: { type: 'string' }, use: [{ type: 'string' }, { type: 'string' }] });
  });

  it("reads a large document with no aliases, however many values it holds: the reviewer's 400,000 lines", () => {
    const big = Array.from({ length: 400_000 }, (_, i) => `k${i}: [1, 2]`).join('\n');
    const doc = parseYaml(big) as Record<string, number[]>;
    expect(Object.keys(doc)).toHaveLength(400_000);
    expect(doc.k399999).toEqual([1, 2]);
  });

  it('reads YAML 1.2 core types and keeps dates as the strings they were written as', () => {
    const doc = parseYaml(OPENAPI_YAML) as { openapi: string; info: { version: string }; paths: Record<string, { get: { responses: Record<string, { content: Record<string, { example: unknown }> }> } }> };
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.version).toBe('1.0');
    const example = doc.paths['/orders/{id}']!.get.responses['200']!.content['application/json']!.example;
    expect(example).toEqual({ id: 'abc12345', placed: '2026-01-01', total: 12.5, paid: true, note: null });
  });

  it('refuses a key given twice, with the line and column and no text from the file', () => {
    const run = () => parseYaml('a: 1\nb: 2\na: 3\n', 'the file "api.yaml"');
    expect(run).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringMatching(/^The file "api.yaml" isn't valid YAML at line 3, column \d+: duplicated mapping key\.$/), details: { line: 3, column: expect.any(Number) } }));
  });

  it('refuses a stream of several documents, saying to pass one', () => {
    expect(() => parseYaml('a: 1\n---\nb: 2\n')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT', fix: 'Pass a single YAML document.' }));
  });
});

/** Draft-04, the dialect of the ADF and OpenAPI 3.0 schemas: definitions, $ref and boolean exclusiveMinimum. */
const DRAFT4: Schema = {
  $schema: 'http://json-schema.org/draft-04/schema#',
  type: 'object',
  required: ['type', 'version', 'content'],
  properties: {
    type: { enum: ['doc'] },
    version: { type: 'integer', minimum: 1, exclusiveMinimum: false },
    content: { type: 'array', items: { $ref: '#/definitions/node' } },
  },
  definitions: {
    node: { type: 'object', required: ['type'], properties: { type: { type: 'string' }, text: { type: 'string', minLength: 1 } } },
  },
};

describe('validateSchema', () => {
  it('reads the draft from $schema', () => {
    expect(schemaDraft(DRAFT4)).toBe('4');
    expect(schemaDraft({ $schema: 'http://json-schema.org/draft-07/schema#' })).toBe('7');
    expect(schemaDraft({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toBe('2020-12');
    expect(schemaDraft({})).toBe('2020-12');
  });

  it('accepts a valid value', () => {
    expect(validateSchema(DRAFT4, { type: 'doc', version: 1, content: [{ type: 'paragraph' }] })).toEqual({ valid: true, problems: [], total: 0 });
  });

  it('reports each problem by JSON pointer, deepest first, with the keyword and the schema location', () => {
    const result = validateSchema(DRAFT4, { type: 'doc', version: 0, content: [{ type: 'text', text: '' }, {}] });
    expect(result.valid).toBe(false);
    const where = result.problems.map((p) => `${p.pointer} ${p.keyword}`);
    expect(where).toEqual(expect.arrayContaining(['/content/0/text minLength', '/content/1 required', '/version minimum']));
    expect(result.problems[0]!.pointer.split('/').length).toBeGreaterThanOrEqual(result.problems.at(-1)!.pointer.split('/').length);
    const minLength = result.problems.find((p) => p.keyword === 'minLength')!;
    expect(minLength.schemaPointer).toBe('/properties/content/items/$ref/properties/text/minLength');
    expect(result.total).toBe(result.problems.length);
  });

  it('gives pointers as JSON pointers, not URI fragments: braces, spaces and percent signs as written', () => {
    const schema: Schema = { type: 'object', additionalProperties: { type: 'object', required: ['get'] } };
    const result = validateSchema(schema, { '/pets/{id}': {}, 'a b': {}, '100%': {} });
    expect(result.problems.map((p) => p.pointer).filter(Boolean).sort()).toEqual(['/100%', '/a b', '/~1pets~1{id}']);
  });

  it('leafProblems keeps what is wrong and drops the enclosing keywords that failed because of it', () => {
    const result = validateSchema(DRAFT4, { type: 'doc', version: 1, content: [{ type: 'text', text: '' }, {}] }, { maxProblems: Infinity });
    expect(result.problems.some((p) => p.pointer === '' || p.keyword === 'items' || p.keyword === '$ref')).toBe(true);
    expect(leafProblems(result.problems).map((p) => `${p.pointer} ${p.keyword}`).sort()).toEqual(['/content/0/text minLength', '/content/1 required']);
  });

  it('leafProblems keeps a failure at a node whose child fails too: a missing property and a wrong type are two problems', () => {
    const schema: Schema = { type: 'object', properties: { owner: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' } } } } };
    const result = validateSchema(schema, { owner: { id: 7 } }, { maxProblems: Infinity });
    expect(leafProblems(result.problems).map((p) => `${p.pointer} ${p.keyword}`).sort()).toEqual(['/owner required', '/owner/id type']);
  });

  it.each([
    ['anyOf', 22],
    ['oneOf', 18],
  ])('refuses, quickly and as unchecked, a %s diamond of refs that would take 2^n checks', (keyword, levels) => {
    const defs: Record<string, Schema> = { [`S${levels}`]: { type: 'string' } };
    for (let i = 0; i < levels; i++) defs[`S${i}`] = { [keyword]: [{ $ref: `#/definitions/S${i + 1}` }, { $ref: `#/definitions/S${i + 1}` }] };
    const schema: Schema = { $schema: 'http://json-schema.org/draft-07/schema#', $ref: '#/definitions/S0', definitions: defs };
    const started = performance.now();
    expect(schemaFanOut(schema)).toBeGreaterThan(MAX_SCHEMA_FAN_OUT);
    const result = validateSchema(schema, 'x');
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result).toMatchObject({ valid: false, problems: [], unchecked: expect.stringMatching(/^the schema branches too much to validate/) });
  });

  it('turns a validator that runs out of stack into unchecked, never a crash', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 50_000; i++) deep = [deep];
    const result = validateSchema({ $schema: 'http://json-schema.org/draft-07/schema#', items: { $ref: '#' } }, deep);
    expect(result).toMatchObject({ valid: false, unchecked: expect.stringMatching(/^validation ran out of room/) });
  });

  it('keeps the fan-out of real schemas small: a loop back costs one visit', () => {
    expect(schemaFanOut(DRAFT4)).toBeLessThan(100);
    const tree: Schema = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { children: { type: 'array', items: { $ref: '#' } } }, anyOf: [{ $ref: '#' }, { required: ['children'] }] };
    expect(schemaFanOut(tree)).toBeLessThan(10);
  });

  it.each([
    ['^(a+)+$', /repeats a group that itself repeats/],
    ['(a|aa)*', /alternation whose branches can match the same text/],
    ['(.*a){12}', /repeats a group that itself repeats/],
    ['^(\\w+\\s?)*$', /repeats a group that itself repeats/],
    ['^(a|a?)+$', /repeats a group that itself repeats|alternation/],
    ['^(\\d+)\\1$', /backreference/],
    ['^.*,.*,.*$', /three or more character classes/],
  ])('flags the backtracking shape of %s', (pattern, reason) => {
    expect(regexRisk(pattern)).toMatch(reason);
  });

  it.each(['^[A-Z]{3}-\\d+$', '^sha256:[a-f0-9]{64}$', '^[a-zA-Z0-9\\.\\-_]+$', '^x-', '^[1-5](?:\\d{2}|XX)$', '^(ab)+$', '(a|b)*', '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})$', '^[^@]+@[^@]+$', '^\\/'])('runs the ordinary pattern %s', (pattern) => {
    expect(regexRisk(pattern)).toBeUndefined();
  });

  it('finds no risky pattern in the schemas toil bundles', () => {
    for (const file of ['openapi/schemas/openapi-3.0.json', 'openapi/schemas/openapi-3.1.json', 'openapi/schemas/openapi-3.2.json', 'openapi/schemas/swagger-2.0.json', 'openapi/schemas/json-schema-draft-04.json', 'md/adf-schema.json']) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      for (const [, pattern] of text.matchAll(/"pattern"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) expect(regexRisk(JSON.parse(`"${pattern}"`)), `${file}: ${pattern}`).toBeUndefined();
    }
  });

  it.each(['^(a+)+$', '(a|aa)*$', '^(.*a){12}$'])('never runs %s: validation skips it, fast, and says so', (pattern) => {
    const started = performance.now();
    const result = validateSchema({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'string', pattern }, `${'a'.repeat(40)}!`);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(result).toMatchObject({ valid: true, skippedPatterns: [{ pattern, reason: expect.any(String) }] });
  });

  it('still runs an ordinary pattern, and fails a value that misses it', () => {
    const result = validateSchema({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'string', pattern: '^[A-Z]{3}-\\d+$' }, 'abc-1');
    expect(result).toMatchObject({ valid: false, problems: [expect.objectContaining({ keyword: 'pattern' })] });
    expect(result.skippedPatterns).toBeUndefined();
  });

  it('caps the problems it lists and says how many there were', () => {
    const many = validateSchema({ type: 'array', items: { type: 'string' } }, Array.from({ length: 80 }, (_, i) => i), { maxProblems: 10 });
    expect(many.problems).toHaveLength(10);
    expect(many.total).toBeGreaterThanOrEqual(80);
  });

  it('follows a $ref into a schema it was given separately, as an OpenAPI document refers to its components', () => {
    const pet: Schema = { $id: 'https://schemas.imagile.dev/pet.json', type: 'object', required: ['name'] };
    const list: Schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array', items: { $ref: 'https://schemas.imagile.dev/pet.json' } };
    expect(validateSchema(list, [{ name: 'Rex' }], { references: [{ schema: pet }] }).valid).toBe(true);
    expect(validateSchema(list, [{}], { references: [{ schema: pet }] }).problems).toEqual(expect.arrayContaining([expect.objectContaining({ pointer: '/0', keyword: 'required' })]));
  });
});
