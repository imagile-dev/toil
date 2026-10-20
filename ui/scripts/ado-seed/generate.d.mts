export const DEFAULT_SEED: number;
export const DEFAULT_OUT: string;
export const SEED_CONNECTION: string;
export const SEED_TAG: string;
export const COMMAND: string;
export const PROJECT: string;
export const ME: string;
export const ANCHOR: string;
export const FLOW: Record<string, string[]>;
export interface TimelineEvent { at: string; state?: string; iteration?: string }
/** An OWI 0.1 record as generate() writes it (docs/owi/schema.json); native['ado-seed generate'] holds the seed's own fields. */
export interface SeedRecord {
  owi: '0.1';
  id: string;
  source: { area: string; connection: string; key: string; command: string };
  url: null;
  type: string;
  typeName: string;
  title: string;
  body: { format: 'html'; content: string };
  status: string;
  statusCategory: string;
  resolution: null;
  assignee: { id: string; name: null; email: null } | null;
  reporter: null;
  priority: string;
  estimate: { value: number; unit: 'points'; field: string } | null;
  labels: string[];
  team: null;
  iteration: { id: null; name: string; path: string; start: null; end: null; state: null };
  parent: string | null;
  children: string[];
  links: Array<{ type: string; direction: string; target: string; name: string }>;
  created: null;
  updated: null;
  resolved: null;
  dueDate: null;
  history: null;
  unmapped: Array<{ field: string; reason: string }>;
  native: { 'ado-seed generate': { product: string; areaPath: string; stale?: boolean; timeline: TimelineEvent[]; fields: Record<string, unknown> } };
}
export function random(seed: number): () => number;
export function pathTo(typeName: string, last: string, removedFrom?: string): string[];
export function generate(seed?: number): SeedRecord[];
export function check(items: unknown[]): string[];
export function render(items: unknown[], seed: number): string;
