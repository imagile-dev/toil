import { z } from 'zod';
import { ToilError } from '../../../core/errors.js';
import type { Warning } from '../../../core/envelope.js';
import { KIND_LABEL, VIEW_TYPES, type ComputedView, type Element, type ElementKind, type ViewEdge, type ViewType } from './view.js';

export { typeLine, VIEW_TYPES, type ComputedView, type Element, type ElementKind, type ViewEdge, type ViewType } from './view.js';

/**
 * The C4 model the `util c4` commands draw: people and software systems at
 * the top, containers inside systems, components inside containers, the
 * relationships between any of them, and the views to draw. The schema is
 * the whole contract; there is no DSL to parse. A view is computed here once
 * and handed to each renderer (SVG, Mermaid, D2), so the three can't
 * disagree about what a view shows.
 *
 * Relationships are drawn at the most detailed level a view shows: one
 * between two containers is implied between their systems in a system
 * context view. This is how the C4 notation works, and also how most
 * reorganisations are announced: the boxes move, the arrows stay.
 */

const ID_RULE = 'must start with a letter and hold only letters, digits and underscores';
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, `an id ${ID_RULE}`).describe(`Unique across the whole model; ${ID_RULE}`);
const name = z.string().min(1, 'a name is required').describe('The name shown on the box');
const description = z.string().optional().describe('What it is or does, in a sentence');
const technology = z.string().optional().describe('The technology, e.g. "React", "PostgreSQL", "Spring Boot"');
const external = z.boolean().optional().describe('Outside the organisation or team that owns the model; drawn grey (default: false)');

const component = z
  .object({ id, name, description, technology, external })
  .strict()
  .describe('A component: a grouping of code inside a container');

const container = z
  .object({
    id,
    name,
    description,
    technology,
    external,
    database: z.boolean().optional().describe('Draw it as a database (default: false)'),
    components: z.array(component).optional().describe('The components inside this container'),
  })
  .strict()
  .describe('A container: something that runs or stores data, inside a software system');

const system = z
  .object({ id, name, description, external, containers: z.array(container).optional().describe('The containers inside this system') })
  .strict()
  .describe('A software system');

const person = z.object({ id, name, description, external }).strict().describe('A person: a user, actor or role');

const relationship = z
  .object({
    source: z.string().describe('The id of the element the relationship starts from'),
    destination: z.string().describe('The id of the element it points to'),
    description: z.string().optional().describe('What the source does with the destination, e.g. "Reads orders from"'),
    technology,
  })
  .strict()
  .describe('A relationship between two elements, at any level');

const view = z
  .object({
    key: id.describe(`The view's name, passed as --view; ${ID_RULE}`),
    type: z.enum(VIEW_TYPES).describe('systemContext and container views are scoped to a software system, a component view to a container'),
    scope: z.string().describe('The id of the element the view is about: a system for systemContext and container, a container for component'),
    title: z.string().optional().describe('The title drawn above the diagram (default: from the type and scope)'),
    include: z
      .array(z.string())
      .optional()
      .describe('The ids of the elements to show. "*" stands for the default set: for systemContext, the scope and every person and system related to it; for container, its containers and what they relate to; for component, its components and what they relate to (default: ["*"])'),
  })
  .strict()
  .describe('One diagram of the model');

export const c4ModelSchema = z
  .object({
    title: z.string().optional().describe('The name of the model'),
    people: z.array(person).optional().describe('People: users, actors and roles'),
    systems: z.array(system).min(1, 'a model needs at least one software system').describe('Software systems, each with its containers and their components'),
    relationships: z.array(relationship).optional().describe('Relationships between any two elements'),
    views: z.array(view).min(1, 'a model needs at least one view').describe('The views to draw'),
  })
  .strict()
  .describe('A C4 model: elements, relationships and views');

export type C4Model = z.infer<typeof c4ModelSchema>;
export type C4View = C4Model['views'][number];

/** Every element by id, nested ones included. */
export function indexElements(model: C4Model): Map<string, Element> {
  const out = new Map<string, Element>();
  const put = (el: Element) => {
    if (!out.has(el.id)) out.set(el.id, el);
  };
  (model.people ?? []).forEach((p, i) => put({ ...p, kind: 'person', external: p.external ?? false, database: false, path: `people[${i}]` }));
  model.systems.forEach((s, i) => {
    put({ id: s.id, name: s.name, description: s.description, kind: 'system', external: s.external ?? false, database: false, path: `systems[${i}]` });
    (s.containers ?? []).forEach((c, j) => {
      const cPath = `systems[${i}].containers[${j}]`;
      put({ id: c.id, name: c.name, description: c.description, technology: c.technology, kind: 'container', external: c.external ?? s.external ?? false, database: c.database ?? false, parent: s.id, path: cPath });
      (c.components ?? []).forEach((k, n) =>
        put({ ...k, kind: 'component', external: k.external ?? c.external ?? s.external ?? false, database: false, parent: c.id, path: `${cPath}.components[${n}]` }),
      );
    });
  });
  return out;
}

/** The whole model's id paths, in order, duplicates included: what `indexElements` keeps only the first of. */
function allIdPaths(model: C4Model): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  (model.people ?? []).forEach((p, i) => out.push([p.id, `people[${i}]`]));
  model.systems.forEach((s, i) => {
    out.push([s.id, `systems[${i}]`]);
    (s.containers ?? []).forEach((c, j) => {
      out.push([c.id, `systems[${i}].containers[${j}]`]);
      (c.components ?? []).forEach((k, n) => out.push([k.id, `systems[${i}].containers[${j}].components[${n}]`]));
    });
  });
  return out;
}

const SCOPE_KIND: Record<ViewType, ElementKind> = { systemContext: 'system', container: 'system', component: 'container' };

/**
 * The checks a schema can't make: ids unique, every reference pointing at an
 * element that exists, and each view scoped to the right kind. Every problem
 * is reported at once, by path, so a model is fixed in one round.
 */
export function checkModel(model: C4Model): Array<{ path: string; message: string }> {
  const problems: Array<{ path: string; message: string }> = [];
  const seen = new Map<string, string>();
  for (const [elId, path] of allIdPaths(model)) {
    const first = seen.get(elId);
    if (first) problems.push({ path: `${path}.id`, message: `"${elId}" is already the id of ${first}; ids are unique across the whole model` });
    else seen.set(elId, path);
  }
  const elements = indexElements(model);
  const known = (ref: string) => (elements.has(ref) ? undefined : `no element has the id "${ref}"`);
  (model.relationships ?? []).forEach((rel, i) => {
    for (const end of ['source', 'destination'] as const) {
      const problem = known(rel[end]);
      if (problem) problems.push({ path: `relationships[${i}].${end}`, message: problem });
    }
    if (rel.source === rel.destination) problems.push({ path: `relationships[${i}]`, message: `"${rel.source}" relates to itself; a relationship joins two different elements` });
  });
  const keys = new Set<string>();
  model.views.forEach((v, i) => {
    if (keys.has(v.key)) problems.push({ path: `views[${i}].key`, message: `"${v.key}" is already the key of another view` });
    keys.add(v.key);
    const scope = elements.get(v.scope);
    const want = SCOPE_KIND[v.type];
    if (!scope) problems.push({ path: `views[${i}].scope`, message: `no element has the id "${v.scope}"` });
    else if (scope.kind !== want) problems.push({ path: `views[${i}].scope`, message: `a ${v.type} view is scoped to a ${want === 'system' ? 'software system' : 'container'}, and "${v.scope}" is a ${KIND_LABEL[scope.kind].toLowerCase()}` });
    (v.include ?? []).forEach((ref, j) => {
      const problem = ref === '*' ? undefined : known(ref);
      if (problem) problems.push({ path: `views[${i}].include[${j}]`, message: `${problem} (use "*" for the default set)` });
    });
  });
  return problems;
}

const MODEL_FIX = 'Fix each path listed. The model holds people, systems (with containers and their components), relationships and views; ids are unique across the whole model.';

/** The most a model may hold: elements (people, systems, containers and components together), relationships and views. Past any of them it's INVALID_INPUT. */
export const MODEL_LIMITS = { elements: 1_000, relationships: 2_000, views: 100 } as const;
/** The most one drawn view may hold, for `render`: boxes and arrows. The layout is superlinear, so this is what keeps it in milliseconds. */
export const VIEW_LIMITS = { boxes: 100, arrows: 250 } as const;

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const field = (value: unknown, key: string): unknown => (value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined);

/** Counts what a parsed but unchecked model holds, before the schema walks it, so an oversized one is refused before any work grows with it. */
function checkSize(value: unknown, where: string): void {
  const systems = list(field(value, 'systems'));
  const containers = systems.flatMap((s) => list(field(s, 'containers')));
  const components = containers.flatMap((c) => list(field(c, 'components')));
  const counts = {
    elements: list(field(value, 'people')).length + systems.length + containers.length + components.length,
    relationships: list(field(value, 'relationships')).length,
    views: list(field(value, 'views')).length,
  };
  for (const key of ['elements', 'relationships', 'views'] as const) {
    if (counts[key] > MODEL_LIMITS[key]) {
      throw new ToilError('INVALID_INPUT', `The C4 model in ${where} has ${counts[key]} ${key}, and a model may have at most ${MODEL_LIMITS[key]}.`, {
        fix: `Split the model into smaller ones, each with at most ${MODEL_LIMITS.elements} elements, ${MODEL_LIMITS.relationships} relationships and ${MODEL_LIMITS.views} views.`,
      });
    }
  }
}

/**
 * Whether `render` may draw a view: at most {@link VIEW_LIMITS} boxes and
 * arrows. Mermaid and D2 text is written in one linear pass and has no such
 * limit beyond the model's own.
 */
export function checkDrawable(view: ComputedView): void {
  const boxes = view.inside.length + view.outside.length;
  const arrows = view.edges.length;
  if (boxes > VIEW_LIMITS.boxes || arrows > VIEW_LIMITS.arrows) {
    throw new ToilError('INVALID_INPUT', `View "${view.key}" has ${boxes} boxes and ${arrows} arrows, and render draws at most ${VIEW_LIMITS.boxes} boxes and ${VIEW_LIMITS.arrows} arrows.`, {
      fix: 'Draw fewer elements in this view with its include list, or split it into several views. util c4 mermaid and util c4 d2 write views of any size the model allows.',
    });
  }
}

/** A parsed, checked model, from the text of the input: its mistakes are all named by path. */
export function loadModel(raw: string, where: string): C4Model {
  let value: unknown;
  try {
    value = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    throw new ToilError('INVALID_INPUT', `${where} is not valid JSON: ${(err as Error).message}`, { fix: 'Pass one JSON object, the C4 model.' });
  }
  checkSize(value, where);
  const parsed = c4ModelSchema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => ({ path: i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '') || '(the model)', message: i.message }));
    throw invalidModel(where, problems);
  }
  const problems = checkModel(parsed.data);
  if (problems.length > 0) throw invalidModel(where, problems);
  return parsed.data;
}

function invalidModel(where: string, problems: Array<{ path: string; message: string }>): ToilError {
  const shown = problems.slice(0, 20).map((p) => `${p.path}: ${p.message}`);
  const more = problems.length > 20 ? `; and ${problems.length - 20} more` : '';
  return new ToilError('INVALID_INPUT', `The C4 model in ${where} has ${problems.length === 1 ? 'a problem' : `${problems.length} problems`}: ${shown.join('; ')}${more}.`, {
    fix: MODEL_FIX,
    details: problems,
  });
}

/** The view named `key`, or the only one when no key is given. */
export function pickView(model: C4Model, key: string | undefined): C4View {
  const keys = model.views.map((v) => v.key).join(', ');
  if (key === undefined) {
    if (model.views.length === 1) return model.views[0]!;
    throw new ToilError('INVALID_INPUT', `The model has ${model.views.length} views, and no --view said which to draw.`, { fix: `Pass --view <key>, one of: ${keys}.` });
  }
  const found = model.views.find((v) => v.key === key);
  if (!found) throw new ToilError('INVALID_INPUT', `The model has no view "${key}".`, { fix: `Pass --view <key>, one of: ${keys}.` });
  return found;
}

const DEFAULT_TITLE: Record<ViewType, string> = { systemContext: 'System context', container: 'Containers', component: 'Components' };

/**
 * What a view draws. The default set ("*") follows the C4 notation: the
 * scope's children inside its boundary, plus whatever they relate to, each
 * relationship drawn between the nearest elements the view shows. A
 * relationship that lands on the boundary itself from outside can't be drawn
 * there, and a warning names it unless the same outside element already has a
 * drawn relationship into the boundary.
 */
export function computeView(model: C4Model, v: C4View, warn: (w: Warning) => void = () => {}): ComputedView {
  const elements = indexElements(model);
  const scope = elements.get(v.scope)!;
  const ancestors = (el: Element): Element[] => {
    const out: Element[] = [];
    for (let at = el.parent ? elements.get(el.parent) : undefined; at; at = at.parent ? elements.get(at.parent) : undefined) out.push(at);
    return out;
  };
  const within = (el: Element, root: Element) => ancestors(el).some((a) => a.id === root.id);
  const topLevel = (el: Element) => ancestors(el).at(-1) ?? el;
  const boundary = v.type === 'systemContext' ? undefined : scope;
  const system = v.type === 'component' ? elements.get(scope.parent!)! : scope;

  /** Where an element shows up in the default set: itself, or the ancestor at the view's level. */
  const level = (el: Element): Element => {
    if (v.type === 'systemContext') return topLevel(el);
    if (v.type === 'container') return within(el, scope) ? ancestors(el).find((a) => a.kind === 'container') ?? el : topLevel(el);
    if (within(el, scope)) return el;
    if (el.id === scope.id) return el;
    if (within(el, system)) return el.kind === 'component' ? elements.get(el.parent!)! : el;
    return topLevel(el);
  };

  const rels = model.relationships ?? [];
  const visible = new Set<string>();
  const include = v.include ?? ['*'];
  if (include.includes('*')) {
    if (v.type === 'systemContext') visible.add(scope.id);
    else for (const el of elements.values()) if (el.parent === scope.id) visible.add(el.id);
    for (const rel of rels) {
      const ends = [elements.get(rel.source)!, elements.get(rel.destination)!];
      const inScope = (el: Element) => (v.type === 'systemContext' ? topLevel(el).id === scope.id : within(el, scope));
      if (!ends.some(inScope)) continue;
      for (const end of ends) {
        const shown = level(end);
        if (shown.id !== scope.id || v.type === 'systemContext') visible.add(shown.id);
      }
    }
  }
  for (const ref of include) if (ref !== '*' && ref !== boundary?.id) visible.add(ref);

  /** The nearest element the view shows for `el`: itself, or its closest shown ancestor. */
  const shownAs = (el: Element): Element | undefined => [el, ...ancestors(el)].find((a) => visible.has(a.id));

  const edges: ViewEdge[] = [];
  const seen = new Set<string>();
  const boundaryEnds: Array<{ index: number; outside: string }> = [];
  rels.forEach((rel, index) => {
    const src = elements.get(rel.source)!;
    const dst = elements.get(rel.destination)!;
    const from = shownAs(src);
    const to = shownAs(dst);
    if (boundary && (src.id === boundary.id || dst.id === boundary.id)) {
      // Ends on the boundary itself, which is drawn as a frame, not a box.
      const other = src.id === boundary.id ? dst : src;
      if (!within(other, boundary)) boundaryEnds.push({ index, outside: (shownAs(other) ?? other).id });
      return;
    }
    if (!from || !to || from.id === to.id) return;
    const key = JSON.stringify([from.id, to.id, rel.description ?? '', rel.technology ?? '']);
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from: from.id, to: to.id, description: rel.description, technology: rel.technology });
  });
  const insideIds = new Set([...visible].filter((vid) => boundary && within(elements.get(vid)!, boundary)));
  for (const { index, outside } of boundaryEnds) {
    const covered = edges.some((e) => (e.from === outside && insideIds.has(e.to)) || (e.to === outside && insideIds.has(e.from)));
    if (!covered) {
      const rel = rels[index]!;
      warn({
        code: 'C4_RELATIONSHIP_NOT_DRAWN',
        message: `relationships[${index}] (${rel.source} -> ${rel.destination}) ends on the view's boundary "${boundary!.id}", so view "${v.key}" doesn't draw it. Point it at an element inside "${boundary!.id}" to show it here.`,
      });
    }
  }

  const ordered = [...elements.values()].filter((el) => visible.has(el.id));
  return {
    key: v.key,
    type: v.type,
    title: v.title ?? `${DEFAULT_TITLE[v.type]}: ${scope.name}`,
    boundary,
    inside: ordered.filter((el) => insideIds.has(el.id)),
    outside: ordered.filter((el) => !insideIds.has(el.id)),
    edges,
  };
}
