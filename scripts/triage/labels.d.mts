export interface Label {
  name: string;
  color: string;
  description: string;
}
export const FIXED: Label[];
export function areas(dir?: string): string[];
export function labels(dir?: string): Label[];
