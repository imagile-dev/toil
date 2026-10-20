import type { Client } from './ado.mjs';
export function confirmationCode(ids: number[]): string;
export function cleanup(options: { api: Client; identity?: string; confirm?: string; only?: number; log?: (line: string) => void }): Promise<{ listed: number; code: string; deleted: number[] }>;
