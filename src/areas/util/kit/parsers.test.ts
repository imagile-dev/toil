import { describe, expect, it } from 'vitest';
import { schemaDraft, validateSchema, type Schema } from './json-schema.js';
import { parseYaml } from './yaml.js';

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
