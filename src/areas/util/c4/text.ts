import { typeLine, type ComputedView, type Element, type ViewType } from './model.js';

/**
 * A computed C4 view as diagram text, for places that render it themselves:
 * Mermaid's C4 syntax (GitHub renders it inline in markdown) and D2. Both are
 * plain string building; no renderer is loaded. Ids pass through unchanged,
 * since the model's id rule (a letter, then letters, digits and underscores)
 * is already valid in both languages. The text is the diagram; the rendering
 * is somebody else's department.
 */

const MERMAID_HEADER: Record<ViewType, string> = { systemContext: 'C4Context', container: 'C4Container', component: 'C4Component' };

/** A Mermaid C4 string argument. Mermaid has no escape for `"` inside one, so it becomes `'`; a line break becomes a space. */
const m = (text: string | undefined) => `"${(text ?? '').replace(/"/g, "'").replace(/\s*\r?\n\s*/g, ' ')}"`;

function mermaidElement(el: Element): string {
  const ext = el.external ? '_Ext' : '';
  switch (el.kind) {
    case 'person':
      return `Person${ext}(${el.id}, ${m(el.name)}, ${m(el.description)})`;
    case 'system':
      return `System${ext}(${el.id}, ${m(el.name)}, ${m(el.description)})`;
    case 'container':
      return `Container${el.database ? 'Db' : ''}${ext}(${el.id}, ${m(el.name)}, ${m(el.technology)}, ${m(el.description)})`;
    case 'component':
      return `Component${ext}(${el.id}, ${m(el.name)}, ${m(el.technology)}, ${m(el.description)})`;
  }
}

/** The view in Mermaid's C4 syntax: `C4Context`, `C4Container` or `C4Component`. */
export function toMermaid(view: ComputedView): string {
  const lines = [MERMAID_HEADER[view.type], `title ${view.title.replace(/\s*\r?\n\s*/g, ' ')}`, ''];
  lines.push(...view.outside.map(mermaidElement));
  if (view.boundary) {
    const kind = view.boundary.kind === 'system' ? 'System_Boundary' : 'Container_Boundary';
    lines.push('', `${kind}(${view.boundary.id}, ${m(view.boundary.name)}) {`, ...view.inside.map((el) => `  ${mermaidElement(el)}`), '}');
  }
  lines.push('', ...view.edges.map((e) => (e.technology ? `Rel(${e.from}, ${e.to}, ${m(e.description)}, ${m(e.technology)})` : `Rel(${e.from}, ${e.to}, ${m(e.description)})`)));
  return `${lines.join('\n')}\n`;
}

/** A D2 double-quoted string: backslashes and quotes escaped, line breaks as `\n`. */
const d = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;

const D2_STYLE: Record<Element['kind'], { fill: string; stroke: string; font: string }> = {
  person: { fill: '#08427b', stroke: '#073b6f', font: '#ffffff' },
  system: { fill: '#1168bd', stroke: '#0b4884', font: '#ffffff' },
  container: { fill: '#438dd5', stroke: '#3c7fc0', font: '#ffffff' },
  component: { fill: '#85bbf0', stroke: '#78a8d8', font: '#000000' },
};

/** D2's reserved words that a model id can spell; quoted as keys so D2 reads them as names. */
const D2_RESERVED = new Set(['label', 'shape', 'icon', 'style', 'near', 'tooltip', 'link', 'width', 'height', 'direction', 'constraint', 'class', 'classes', 'vars', 'top', 'left', 'layers', 'scenarios', 'steps', 'filled']);
const key = (elId: string) => (D2_RESERVED.has(elId) ? d(elId) : elId);

function d2Element(el: Element, indent: string): string[] {
  const colour = el.external ? { fill: el.kind === 'person' ? '#686868' : '#999999', stroke: '#8a8a8a', font: '#ffffff' } : D2_STYLE[el.kind];
  const label = [el.name, typeLine(el), ...(el.description ? ['', el.description] : [])].join('\n');
  const shape = el.kind === 'person' ? 'c4-person' : el.kind === 'container' && el.database ? 'cylinder' : 'rectangle';
  return [
    `${indent}${key(el.id)}: ${d(label)} {`,
    `${indent}  shape: ${shape}`,
    `${indent}  style: { fill: "${colour.fill}"; stroke: "${colour.stroke}"; font-color: "${colour.font}"${shape === 'rectangle' ? '; border-radius: 8' : ''} }`,
    `${indent}}`,
  ];
}

/** The view in D2: the boundary as a dashed container holding its elements, edges by their D2 paths (`bookshop.web`). */
export function toD2(view: ComputedView): string {
  // The title's key has a space, which no model id can, so it never collides with an element.
  const lines = [`view title: ${d(view.title)} {`, '  shape: text', '  near: top-center', '  style: { font-size: 24; bold: true }', '}', '', 'direction: down', ''];
  for (const el of view.outside) lines.push(...d2Element(el, ''));
  const insideIds = new Set(view.inside.map((el) => el.id));
  if (view.boundary) {
    const b = view.boundary;
    lines.push(`${key(b.id)}: ${d(`${b.name}\n${typeLine(b)}`)} {`, '  style: { stroke: "#444444"; stroke-dash: 4; fill: "#ffffff"; font-color: "#444444" }');
    for (const el of view.inside) lines.push(...d2Element(el, '  '));
    lines.push('}');
  }
  const ref = (elId: string) => (view.boundary && insideIds.has(elId) ? `${key(view.boundary.id)}.${key(elId)}` : key(elId));
  lines.push('');
  for (const e of view.edges) {
    const label = [e.description ?? '', ...(e.technology ? [`[${e.technology}]`] : [])].filter(Boolean).join('\n');
    lines.push(`${ref(e.from)} -> ${ref(e.to)}${label ? `: ${d(label)}` : ''} { style: { stroke: "#707070"; stroke-dash: 3 } }`);
  }
  return `${lines.join('\n')}\n`;
}
