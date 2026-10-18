export interface Terms {
  words: string[];
  domains: string[];
  patterns: RegExp[];
  invalid: number;
}
export const SERVICES: string[];
export function parseTerms(raw?: string): Terms;
export function redact(text: string, terms?: Terms): string;
