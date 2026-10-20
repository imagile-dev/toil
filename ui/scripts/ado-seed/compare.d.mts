import type { SeedRecord } from './generate.mjs';
export function compare(records: SeedRecord[], mapped: ReadonlyArray<object>, options: { project: string; backdated?: boolean }): string[];
