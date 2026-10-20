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
/** An OWI 0.1 record as generate() writes it; native['ado-seed generate'] holds the seed's own fields. */
export type SeedRecord = Record<string, any> & { id: string; source: { key: string }; native: { 'ado-seed generate': { product: string; areaPath: string; stale?: boolean; timeline: TimelineEvent[]; fields: Record<string, unknown> } } };
export function random(seed: number): () => number;
export function pathTo(typeName: string, last: string, removedFrom?: string): string[];
export function generate(seed?: number): SeedRecord[];
export function check(items: unknown[]): string[];
export function render(items: unknown[], seed: number): string;
