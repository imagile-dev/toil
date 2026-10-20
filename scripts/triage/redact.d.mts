export interface Terms {
  words: string[];
  domains: string[];
  patterns: RegExp[];
  invalid: number;
}
export const SERVICES: string[];
export const MAX_LENGTH: number;
export function parseTerms(raw?: string): Terms;
export function normalize(text: string): string;
export function redact(text: string, terms?: Terms): string;
export function tokenShaped(text: string): boolean;
