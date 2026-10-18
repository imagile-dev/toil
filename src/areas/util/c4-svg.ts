import { ToilError } from '../../core/errors.js';
import { typeLine, type ComputedView, type Element, type ViewEdge } from './c4-model.js';

/**
 * A computed C4 view as Graphviz DOT, and DOT as SVG through Graphviz
 * compiled to WebAssembly (`@hpcc-js/wasm-graphviz`, its WASM embedded in
 * the module). Nothing is spawned and nothing is fetched: the library is
 * handed its WASM bytes, so its fetch fallback never runs.
 *
 * The module is imported on the first render, never at startup, so every
 * other command pays nothing for it. The layout engine was requisitioned on
 * the understanding that it would be kept in a drawer until needed.
 */

/** The C4 palette: dark blue people, blue systems, lighter containers, pale components, grey for anything external. */
const FILL: Record<Element['kind'], { fill: string; stroke: string; font: string }> = {
  person: { fill: '#08427b', stroke: '#073b6f', font: '#ffffff' },
  system: { fill: '#1168bd', stroke: '#0b4884', font: '#ffffff' },
  container: { fill: '#438dd5', stroke: '#3c7fc0', font: '#ffffff' },
  component: { fill: '#85bbf0', stroke: '#78a8d8', font: '#000000' },
};
const EXTERNAL = { person: { fill: '#686868', stroke: '#5d5d5d', font: '#ffffff' }, other: { fill: '#999999', stroke: '#8a8a8a', font: '#ffffff' } };

const html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Words wrapped to lines of about `width` characters; a word longer than that keeps its own line. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function nodeLine(el: Element): string {
  const colour = el.external ? (el.kind === 'person' ? EXTERNAL.person : EXTERNAL.other) : FILL[el.kind];
  const parts = [`<b>${html(el.name)}</b>`, `<font point-size="10">${html(typeLine(el))}</font>`];
  if (el.description) parts.push(`<font point-size="11">${wrap(el.description, 32).map(html).join('<br/>')}</font>`);
  const label = `<${parts[0]}<br/>${parts[1]}${parts[2] ? `<br/><br/>${parts[2]}` : ''}>`;
  const shape = el.kind === 'container' && el.database ? 'cylinder' : 'box';
  const style = shape === 'cylinder' ? 'filled' : el.kind === 'person' ? '"rounded,filled,bold"' : '"rounded,filled"';
  return `  ${quote(el.id)} [id=${quote(el.id)}, label=${label}, shape=${shape}, style=${style}, fillcolor="${colour.fill}", color="${colour.stroke}", fontcolor="${colour.font}"];`;
}

function edgeLine(edge: ViewEdge): string {
  const parts: string[] = [];
  if (edge.description) parts.push(wrap(edge.description, 26).map(html).join('<br/>'));
  if (edge.technology) parts.push(`<font point-size="9">[${html(edge.technology)}]</font>`);
  const attrs = parts.length ? ` [label=<${parts.join('<br/>')}>]` : '';
  return `  ${quote(edge.from)} -> ${quote(edge.to)}${attrs};`;
}

/** The view as DOT: one node per element, the boundary as a dashed cluster, one edge per drawn relationship. */
export function toDot(view: ComputedView): string {
  const lines = [
    `digraph ${quote(view.key)} {`,
    `  graph [label=<<b>${html(view.title)}</b>>, labelloc=t, fontsize=18, fontname="Helvetica", rankdir=TB, nodesep=0.7, ranksep=0.9, pad=0.4, bgcolor="#ffffff"];`,
    '  node [fontname="Helvetica", fontsize=13, width=2.6, height=1.3, margin="0.25,0.15", penwidth=1];',
    '  edge [fontname="Helvetica", fontsize=10, color="#707070", fontcolor="#444444", style=dashed, arrowsize=0.8, penwidth=1.2];',
  ];
  if (view.boundary) {
    lines.push(
      `  subgraph ${quote(`cluster_${view.boundary.id}`)} {`,
      `    graph [label=<<b>${html(view.boundary.name)}</b><br/><font point-size="10">${html(typeLine(view.boundary))}</font>>, labeljust=l, labelloc=b, style="dashed,rounded", color="#444444", fontcolor="#444444", fontsize=14, margin=20];`,
      ...view.inside.map((el) => `  ${nodeLine(el)}`),
      '  }',
    );
  }
  lines.push(...view.outside.map(nodeLine), ...view.edges.map(edgeLine), '}');
  return `${lines.join('\n')}\n`;
}

interface GraphvizLike {
  dot(source: string, format?: 'svg'): string;
}

let loading: Promise<GraphvizLike> | undefined;

/** Graphviz, loaded on first use and kept for the life of the process (an MCP server renders many). */
function graphviz(): Promise<GraphvizLike> {
  loading ??= import('@hpcc-js/wasm-graphviz').then((m) => m.Graphviz.load());
  // A failed load isn't cached, so the next call tries again rather than repeat the failure.
  loading.catch(() => (loading = undefined));
  return loading;
}

/** The view as SVG. A layout Graphviz refuses is INTERNAL: the DOT is toil's, so the bug is too. */
export async function renderSvg(view: ComputedView): Promise<string> {
  const dot = toDot(view);
  const gv = await graphviz();
  try {
    return gv.dot(dot, 'svg');
  } catch (err) {
    throw new ToilError('INTERNAL', `Graphviz could not lay out view "${view.key}": ${(err as Error).message}`, {
      fix: 'This is a bug in toil. Please report it at https://github.com/imagile-dev/toil/issues with the model, or try toil util c4 mermaid for the same view as text.',
    });
  }
}
