/**
 * What one C4 view draws, as plain data: the elements and arrows the model
 * computed for it (./model.ts), handed to every renderer so the SVG, Mermaid
 * and D2 can't disagree about what a view shows. No zod here, on purpose:
 * the layout imports this, and the layout runs in the bounded worker
 * (kit/bounded.ts), which carries only what it runs. The org chart, by
 * contrast, carries everyone.
 */

export const VIEW_TYPES = ['systemContext', 'container', 'component'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export type ElementKind = 'person' | 'system' | 'container' | 'component';

export interface Element {
  id: string;
  kind: ElementKind;
  name: string;
  description?: string | undefined;
  technology?: string | undefined;
  external: boolean;
  database: boolean;
  /** The id of the system or container it sits in. */
  parent?: string | undefined;
  /** Where it is in the model, for error messages: `systems[0].containers[1]`. */
  path: string;
}

export interface ViewEdge {
  from: string;
  to: string;
  description?: string | undefined;
  technology?: string | undefined;
}

/** What one view draws, in model order, the same for every renderer. */
export interface ComputedView {
  key: string;
  type: ViewType;
  title: string;
  /** The system (container view) or container (component view) drawn as a dashed boundary; none for system context. */
  boundary?: Element | undefined;
  /** Elements inside the boundary. */
  inside: Element[];
  /** Every other element drawn. */
  outside: Element[];
  edges: ViewEdge[];
}

export const KIND_LABEL: Record<ElementKind, string> = { person: 'Person', system: 'Software System', container: 'Container', component: 'Component' };

/** `[Container: React]`, the C4 type line under a box's name. */
export function typeLine(el: Element): string {
  const kind = el.kind === 'container' && el.database ? 'Container' : KIND_LABEL[el.kind];
  return el.technology ? `[${kind}: ${el.technology}]` : `[${kind}]`;
}
