import { z } from 'zod';
import { defineCommand } from '../../core/command.js';
import type { CommandContext } from '../../core/context.js';
import { ToilError } from '../../core/errors.js';
import { c4ModelSchema, computeView, loadModel, pickView, type C4Model, type ComputedView } from './c4-model.js';
import { renderSvg } from './c4-svg.js';
import { toD2, toMermaid } from './c4-text.js';

/**
 * `util c4 render | mermaid | d2`: one view of a C4 model, as SVG laid out by
 * Graphviz (WASM, loaded only here), or as Mermaid or D2 text. Local only: no
 * connection, no host, no network. The model comes from a file in the
 * workspace (`--model`, `-` for stdin on the CLI) or, over MCP, as the JSON
 * itself (`model`). Every model is checked in full before anything is drawn,
 * and every problem is named by its path. Architecture diagrams are
 * traditionally drawn once, for the review board, and never again; these can
 * be redrawn on every commit, which the board has not yet been told.
 */

type Ctx = CommandContext<unknown, Record<string, string | undefined>>;

const MODEL_FILE = 'A JSON file holding the C4 model, inside the workspace. On the CLI, - reads it from stdin. Give this or model';
const MODEL = 'The C4 model itself, as JSON (people, systems with their containers and components, relationships, views). Give this or modelFile';
const VIEW = 'The key of the view to draw; may be left out when the model has only one';

const modelInput = {
  modelFile: z.string().optional().describe(MODEL_FILE),
  model: c4ModelSchema.optional().describe(MODEL),
  view: z.string().optional().describe(VIEW),
};

const modelOptions = [
  { flags: '--model <file>', field: 'modelFile', description: 'A JSON file holding the C4 model, inside the workspace; - reads it from stdin' },
  { flags: '--model-json <json>', field: 'model', description: 'The C4 model itself, as a JSON string, instead of --model' },
  { flags: '--view <key>', field: 'view', description: 'The key of the view to draw (may be left out when the model has only one)' },
];

/** A small model for the examples: one person, one system, one view. The sample bookshop is in docs/c4/. */
export const EXAMPLE_MODEL: C4Model = {
  people: [{ id: 'reader', name: 'Reader', description: 'Reads the status page' }],
  systems: [{ id: 'status', name: 'Status page', description: 'Says whether the bookshop is up', containers: [{ id: 'site', name: 'Static site', technology: 'HTML' }] }],
  relationships: [{ source: 'reader', destination: 'site', description: 'Checks', technology: 'HTTPS' }],
  views: [{ key: 'context', type: 'systemContext', scope: 'status' }],
};

/** The model from `model` or `modelFile`, checked, and the view it asks for, computed. */
function viewOf(input: { model?: C4Model | undefined; modelFile?: string | undefined; view?: string | undefined }, ctx: Ctx): ComputedView {
  if (input.model !== undefined && input.modelFile !== undefined) {
    throw new ToilError('INVALID_INPUT', 'Both a model file and a model were given, and only one can be drawn.', { fix: 'Pass either --model <file> or --model-json <json> (over MCP, modelFile or model), not both.' });
  }
  let model: C4Model;
  if (input.model !== undefined) model = loadModel(input.model, 'the model input');
  else if (input.modelFile !== undefined) model = loadModel(ctx.files.readText(input.modelFile), input.modelFile === '-' ? 'stdin' : input.modelFile);
  else throw new ToilError('INVALID_INPUT', 'No C4 model was given.', { fix: 'Pass --model <file> (a JSON file in the workspace, or - for stdin) or --model-json <json>; over MCP, model or modelFile.' });
  return computeView(model, pickView(model, input.view), (w) => ctx.warn(w));
}

const summary = (view: ComputedView) => ({
  view: view.key,
  type: view.type,
  title: view.title,
  elements: [...(view.boundary ? [view.boundary.id] : []), ...view.inside.map((el) => el.id), ...view.outside.map((el) => el.id)],
  relationships: view.edges.length,
});

const SHAPE = 'The model is { title?, people[], systems[] (each with containers[], each with components[]), relationships[] of { source, destination, description?, technology? }, views[] of { key, type: systemContext | container | component, scope, title?, include? } }; every id is unique across the model. A view shows its scope\'s children plus whatever they relate to, with relationships drawn between the nearest elements shown; include lists ids to show instead ("*" = the default set).';

export const c4RenderCommand = defineCommand({
  path: ['util', 'c4', 'render'],
  description: 'Draw one view of a C4 model as SVG (local only, no network)',
  toolDescription: `Draws one view of a C4 architecture model as an SVG diagram, laid out by Graphviz (WebAssembly, in process) in the C4 notation: people, software systems, containers and components as coloured boxes with name, type, technology and description, the scope as a dashed boundary, and labelled relationships. Returns { view, type, title, elements[], relationships, format: "svg", svg }, or with out the SVG is saved to that new file in the workspace and { file, bytes } replace svg. ${SHAPE} Local only: no connection and no network. For the same view as text use util_c4_mermaid or util_c4_d2.`,
  input: z.object({
    ...modelInput,
    out: z.string().optional().describe('Write the SVG to this new file inside the workspace instead of returning it; it must not exist yet'),
  }),
  writes: false,
  options: [...modelOptions, { flags: '--out <file>', field: 'out', description: 'Write the SVG to this new file inside the workspace instead of returning it in data' }],
  examples: [{ model: EXAMPLE_MODEL }, { modelFile: 'bookshop.c4.json', view: 'containers' }, { modelFile: 'bookshop.c4.json', view: 'components', out: 'components.svg' }],
  run: async (input, ctx) => {
    const view = viewOf(input, ctx);
    const svg = await renderSvg(view);
    if (input.out === undefined) return { ...summary(view), format: 'svg', svg };
    const bytes = Buffer.from(svg, 'utf8');
    return { ...summary(view), format: 'svg', file: ctx.files.writeBytes(input.out, bytes), bytes: bytes.length };
  },
});

export const c4MermaidCommand = defineCommand({
  path: ['util', 'c4', 'mermaid'],
  description: "Write one view of a C4 model as Mermaid C4 text (local only, no network)",
  toolDescription: `Writes one view of a C4 architecture model as Mermaid text in its C4 syntax (C4Context, C4Container or C4Component, with Person, System, Container, Component, their _Ext and Db forms, a System_Boundary or Container_Boundary, and Rel), which GitHub and other Markdown renderers draw inline in a \`\`\`mermaid block. Returns { view, type, title, elements[], relationships, format: "mermaid", text }. ${SHAPE} Local only. For an SVG use util_c4_render.`,
  input: z.object(modelInput),
  writes: false,
  options: modelOptions,
  examples: [{ model: EXAMPLE_MODEL }, { modelFile: 'bookshop.c4.json', view: 'context' }],
  run: async (input, ctx) => {
    const view = viewOf(input, ctx);
    return { ...summary(view), format: 'mermaid', text: toMermaid(view) };
  },
});

export const c4D2Command = defineCommand({
  path: ['util', 'c4', 'd2'],
  description: 'Write one view of a C4 model as D2 text (local only, no network)',
  toolDescription: `Writes one view of a C4 architecture model as D2 diagram text: each element a styled shape labelled with name, type and description, the scope as a dashed container, and labelled relationships by D2 path (system.container). Returns { view, type, title, elements[], relationships, format: "d2", text }. ${SHAPE} Local only. For an SVG use util_c4_render.`,
  input: z.object(modelInput),
  writes: false,
  options: modelOptions,
  examples: [{ model: EXAMPLE_MODEL }, { modelFile: 'bookshop.c4.json', view: 'containers' }],
  run: async (input, ctx) => {
    const view = viewOf(input, ctx);
    return { ...summary(view), format: 'd2', text: toD2(view) };
  },
});

export const c4Commands = [c4RenderCommand, c4MermaidCommand, c4D2Command];
