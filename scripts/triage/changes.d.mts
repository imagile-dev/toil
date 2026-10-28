export interface RawEntry {
  path: string;
  newMode: string;
}
export function isUi(path: string): boolean;
export function isSafetyLayer(path: string): boolean;
export function areaOf(path: string, areas: string[]): string | undefined;
export function refusal(path: string, areas: string[]): string | undefined;
export function parseRaw(raw: string): RawEntry[];
export function check(entries: RawEntry[], areas: string[]): { ok: boolean; areas: string[]; ui: boolean; core: boolean; safety: string[]; refused: string[] };
