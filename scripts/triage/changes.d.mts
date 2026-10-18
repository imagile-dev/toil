export interface RawEntry {
  path: string;
  newMode: string;
}
export function areaOf(path: string, areas: string[]): string | undefined;
export function parseRaw(raw: string): RawEntry[];
export function check(entries: RawEntry[], areas: string[]): { ok: boolean; area: string | undefined; refused: string[] };
