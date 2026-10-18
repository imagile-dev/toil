import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BOOKSHOP_C4 } from '../../../test/fixtures/util.fixture.js';
import { runCli } from '../../../test/harness/cli.js';
import { testContext } from '../../../test/harness/context.js';
import { execute } from '../../core/run.js';
import type { Warning } from '../../core/envelope.js';
import { c4D2Command, c4MermaidCommand, c4RenderCommand, EXAMPLE_MODEL } from './c4.js';
import { checkModel, computeView, loadModel, type C4Model } from './c4-model.js';
import { toDot, wrap } from './c4-svg.js';
import { toD2, toMermaid } from './c4-text.js';
import { commands } from './index.js';

/**
 * The C4 commands end to end through execute() and the real CLI, and the
 * model, view and text renderers on their own. The SVG tests run the real
 * Graphviz WASM, since that is the part most worth knowing still loads; it
 * is local, so no network is involved, only a short wait for the compiler.
 * An architecture diagram nobody has rendered is, for audit purposes, a plan.
 */

const bookshop = (): C4Model => JSON.parse(BOOKSHOP_C4) as C4Model;
const view = (model: C4Model, key: string, warn?: (w: Warning) => void) => computeView(model, model.views.find((v) => v.key === key)!, warn);
const files = { 'bookshop.c4.json': BOOKSHOP_C4 };

describe('the sample model', () => {
  it('is the same file in docs/c4/ and the test fixtures', () => {
    expect(readFileSync(new URL('../../../docs/c4/bookshop.c4.json', import.meta.url), 'utf8')).toBe(BOOKSHOP_C4);
  });

  it('is valid, and uses only placeholder hosts', () => {
    expect(checkModel(loadModel(BOOKSHOP_C4, 'bookshop'))).toEqual([]);
    expect(BOOKSHOP_C4).toContain('bookshop.imagile.dev');
    expect(BOOKSHOP_C4.match(/\b[\w-]+(\.[\w-]+)*\.(com|net|org|io|dev)\b/g)?.filter((h) => !h.endsWith('.imagile.dev')) ?? []).toEqual([]);
  });
});

describe('computing a view', () => {
  it('system context: the scope and every person and system related to it, relationships lifted to them', () => {
    const v = view(bookshop(), 'context');
    expect(v.boundary).toBeUndefined();
    expect(v.outside.map((e) => e.id)).toEqual(['customer', 'staff', 'bookshop', 'payments', 'email', 'warehouse']);
    expect(v.edges.map((e) => `${e.from}->${e.to}`)).toEqual([
      'customer->bookshop',
      'staff->bookshop',
      'bookshop->payments',
      'bookshop->email',
      'bookshop->warehouse',
      'email->customer',
    ]);
  });

  it('container: the containers inside the boundary, and identical lifted relationships drawn once', () => {
    const v = view(bookshop(), 'containers');
    expect(v.boundary?.id).toBe('bookshop');
    expect(v.inside.map((e) => e.id)).toEqual(['web', 'admin', 'api', 'worker', 'db']);
    expect(v.outside.map((e) => e.id)).toEqual(['customer', 'staff', 'payments', 'email', 'warehouse']);
    // web calls three components of api with the same words: one arrow.
    expect(v.edges.filter((e) => e.from === 'web' && e.to === 'api')).toHaveLength(1);
    expect(v.edges.find((e) => e.from === 'api' && e.to === 'payments')).toMatchObject({ description: 'Charges cards with', technology: 'JSON/HTTPS' });
  });

  it('component: the components inside the container, and their neighbours at container or system level', () => {
    const v = view(bookshop(), 'components');
    expect(v.boundary?.id).toBe('api');
    expect(v.inside.map((e) => e.id)).toEqual(['catalogue', 'basket', 'orders', 'payment_adapter']);
    expect(v.outside.map((e) => e.id)).toEqual(['web', 'admin', 'db', 'payments']);
  });

  it('an include list shows exactly those elements, with "*" for the default set', () => {
    const model = bookshop();
    model.views.push({ key: 'narrow', type: 'container', scope: 'bookshop', include: ['web', 'api', 'customer'] });
    const v = view(model, 'narrow');
    expect(v.inside.map((e) => e.id)).toEqual(['web', 'api']);
    expect(v.outside.map((e) => e.id)).toEqual(['customer']);
    expect(v.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['customer->web', 'web->api']);
  });

  it('warns about a relationship that ends on the boundary, unless the same element already has an arrow into it', () => {
    const model = bookshop();
    model.relationships!.push({ source: 'customer', destination: 'bookshop', description: 'Uses' }, { source: 'staff', destination: 'api', description: 'Calls' });
    model.people!.push({ id: 'auditor', name: 'Auditor' });
    model.relationships!.push({ source: 'auditor', destination: 'bookshop', description: 'Audits' });
    const warnings: Warning[] = [];
    view(model, 'containers', (w) => warnings.push(w));
    expect(warnings).toEqual([{ code: 'C4_RELATIONSHIP_NOT_DRAWN', message: expect.stringContaining('relationships[19] (auditor -> bookshop)') }]);
  });
});

describe('checking a model', () => {
  it('names every problem by its path at once', () => {
    const model = bookshop();
    model.systems[0]!.containers!.push({ id: 'customer', name: 'Customer service' });
    model.relationships![0]!.destination = 'warehose';
    model.views[2]!.scope = 'bookshop';
    model.views[1]!.include = ['nope'];
    expect(() => loadModel(model, 'the model input')).toThrow(
      expect.objectContaining({
        code: 'INVALID_INPUT',
        message: expect.stringContaining('has 4 problems: systems[0].containers[5].id: "customer" is already the id of people[0]'),
        details: [
          { path: 'systems[0].containers[5].id', message: '"customer" is already the id of people[0]; ids are unique across the whole model' },
          { path: 'relationships[0].destination', message: 'no element has the id "warehose"' },
          { path: 'views[1].include[0]', message: 'no element has the id "nope" (use "*" for the default set)' },
          { path: 'views[2].scope', message: 'a component view is scoped to a container, and "bookshop" is a software system' },
        ],
      }),
    );
  });

  it('names schema problems in a file by path too', () => {
    const text = JSON.stringify({ systems: [{ id: '1bad', name: '' }], views: [], extra: true });
    expect(() => loadModel(text, 'model.json')).toThrow(
      expect.objectContaining({
        details: expect.arrayContaining([
          { path: 'systems[0].id', message: expect.stringContaining('must start with a letter') },
          { path: 'systems[0].name', message: 'a name is required' },
          { path: 'views', message: 'a model needs at least one view' },
          { path: '(the model)', message: expect.stringContaining('extra') },
        ]),
      }),
    );
  });

  it('refuses a file that is not JSON, saying which file', () => {
    expect(() => loadModel('{ nope', 'model.json')).toThrow(/model.json is not valid JSON/);
  });

  it('refuses a relationship from an element to itself', () => {
    expect(checkModel({ ...EXAMPLE_MODEL, relationships: [{ source: 'site', destination: 'site' }] })).toEqual([
      { path: 'relationships[0]', message: '"site" relates to itself; a relationship joins two different elements' },
    ]);
  });
});

describe('text output', () => {
  it('Mermaid uses the C4 macros for each kind, the boundary, and Rel with technology', () => {
    const text = toMermaid(view(bookshop(), 'containers'));
    expect(text.split('\n').slice(0, 2)).toEqual(['C4Container', 'title Containers: Online Bookshop']);
    expect(text).toContain('Person(customer, "Customer", "Browses and buys books online")');
    expect(text).toContain('System_Ext(payments, "Payment provider", "Takes card payments")');
    expect(text).toContain('System_Boundary(bookshop, "Online Bookshop") {\n  Container(web, "Web shop", "TypeScript, React",');
    expect(text).toContain('  ContainerDb(db, "Shop database", "PostgreSQL",');
    expect(text).toContain('Rel(email, customer, "Emails order confirmations to")\n');
    expect(toMermaid(view(bookshop(), 'context')).startsWith('C4Context\n')).toBe(true);
    expect(toMermaid(view(bookshop(), 'components'))).toContain('Container_Boundary(api, "Shop API") {\n  Component(catalogue,');
  });

  it('Mermaid has no escape for a double quote, so it becomes a single one', () => {
    const model: C4Model = { ...EXAMPLE_MODEL, people: [{ id: 'reader', name: 'The "reader"' }] };
    expect(toMermaid(computeView(model, model.views[0]!))).toContain("Person(reader, \"The 'reader'\", \"\")");
  });

  it('D2 nests the boundary, addresses inside elements by path, and quotes reserved words and quotes', () => {
    const text = toD2(view(bookshop(), 'containers'));
    expect(text).toContain('customer -> bookshop.web: "Browses and buys books using\\n[HTTPS]"');
    expect(text).toContain('  db: "Shop database\\n[Container: PostgreSQL]\\n\\nBooks, customers, baskets and orders" {\n    shape: cylinder');
    const model: C4Model = { ...EXAMPLE_MODEL, people: [{ id: 'label', name: 'Say "hi"' }], relationships: [{ source: 'label', destination: 'status' }] };
    const d2 = toD2(computeView(model, model.views[0]!));
    expect(d2).toContain('"label": "Say \\"hi\\"\\n[Person]" {');
    expect(d2).toContain('"label" -> status { style');
  });
});

describe('DOT', () => {
  it('wraps descriptions on word boundaries', () => {
    expect(wrap('Catalogue, basket and order logic over JSON/HTTPS', 20)).toEqual(['Catalogue, basket', 'and order logic over', 'JSON/HTTPS']);
  });

  it('escapes HTML in labels and draws a database as a cylinder inside the boundary cluster', () => {
    const model = bookshop();
    model.systems[0]!.containers![0]!.name = 'Web <shop> & co';
    const dot = toDot(view(model, 'containers'));
    expect(dot).toContain('<b>Web &lt;shop&gt; &amp; co</b>');
    expect(dot).toMatch(/subgraph "cluster_bookshop" \{[\s\S]*\n {4}"db" \[.*shape=cylinder/);
  });
});

describe('util c4 commands', () => {
  it('render returns the SVG, laid out by Graphviz, with what it drew', async () => {
    const envelope = await execute(c4RenderCommand, { modelFile: 'bookshop.c4.json', view: 'context' }, testContext({ files }).context);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { svg: string; elements: string[]; relationships: number; format: string };
    expect(data).toMatchObject({ view: 'context', type: 'systemContext', title: 'System context: Online Bookshop', format: 'svg', relationships: 6 });
    expect(data.svg).toContain('<svg');
    expect(data.svg).toContain('Online Bookshop');
    expect(data.svg).toContain('[Software System]');
  });

  it('render --out writes a new file in the workspace and returns its path and size instead of the SVG', async () => {
    const { context, files: written } = testContext({ files });
    const envelope = await execute(c4RenderCommand, { modelFile: 'bookshop.c4.json', view: 'containers', out: 'out/containers.svg' }, context);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { file: string; bytes: number; svg?: string };
    expect(data.svg).toBeUndefined();
    expect(data.file).toMatch(/out\/containers\.svg$/);
    const saved = Object.values(written.written)[0]!;
    expect(data.bytes).toBe(saved.length);
    expect(Buffer.from(saved).toString('utf8')).toContain('<svg');
  });

  it('reads the model from stdin on the CLI', async () => {
    const run = await runCli(['util', 'c4', 'mermaid', '--model', '-', '--view', 'components'], { commands, context: testContext({ stdin: BOOKSHOP_C4 }).context });
    expect(run.envelope?.ok).toBe(true);
    expect((run.envelope?.data as { text: string }).text.startsWith('C4Component\n')).toBe(true);
  });

  it('takes the model as JSON on the CLI with --model-json', async () => {
    const run = await runCli(['util', 'c4', 'd2', '--model-json', JSON.stringify(EXAMPLE_MODEL)], { commands, context: testContext().context });
    expect(run.envelope?.data).toMatchObject({ view: 'context', format: 'd2', elements: ['reader', 'status'], relationships: 1 });
  });

  it.each([
    [{}, 'No C4 model was given.'],
    [{ model: EXAMPLE_MODEL, modelFile: 'bookshop.c4.json' }, 'Both a model file and a model were given'],
    [{ modelFile: 'bookshop.c4.json' }, 'The model has 3 views, and no --view said which to draw.'],
    [{ modelFile: 'bookshop.c4.json', view: 'deployment' }, 'The model has no view "deployment".'],
  ])('refuses %j with INVALID_INPUT', async (input, message) => {
    const envelope = await execute(c4MermaidCommand, input, testContext({ files }).context);
    expect(envelope.error).toMatchObject({ code: 'INVALID_INPUT', message: expect.stringContaining(message) });
    if (message.startsWith('The model has')) expect(envelope.error?.fix).toBe('Pass --view <key>, one of: context, containers, components.');
  });

  it('refuses a bad model over the input schema with the path that is wrong', async () => {
    const envelope = await execute(c4D2Command, { model: { ...EXAMPLE_MODEL, views: [{ key: 'v', type: 'deployment', scope: 'status' }] } }, testContext().context);
    expect(envelope.error?.code).toBe('INVALID_INPUT');
    expect(envelope.error?.message).toContain('model.views[0].type');
  });
});
