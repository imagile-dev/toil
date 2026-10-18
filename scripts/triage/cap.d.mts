export const CLAIMED: string;
export const QUEUED: string;
export const TRIAGED: string;
export const DENIED: string;
export const FAILED: string;
export const NEEDS_HUMAN: string;
export const SOURCES: string[];
export interface LabelEvent {
  id: number;
  event: string;
  created_at: string;
  label?: { name: string };
  issue?: { number: number };
}
export interface IssueLike {
  number: number;
  state: string;
  labels: Array<string | { name: string }>;
  pull_request?: unknown;
}
export interface Options {
  fetcher?: typeof fetch;
  token?: string;
  attempts?: number;
  pause?: number;
  now?: Date;
}
export function utcDay(iso: string): string;
export function claimRank(events: LabelEvent[], issue: number, day: string): number;
export function waiting<T extends IssueLike>(issues: T[]): T[];
export function gh(method: string, path: string, body?: unknown, options?: Options): Promise<unknown>;
export function claim(repo: string, issue: number, cap: number, options?: Options): Promise<{ run: boolean; reason: string }>;
export function drain(repo: string, cap: number, options?: Options): Promise<number[]>;
