import type { SeedRecord } from './generate.mjs';
export function compare(records: SeedRecord[], mapped: Array<Record<string, any>>, options: { project: string; backdated?: boolean }): string[];
