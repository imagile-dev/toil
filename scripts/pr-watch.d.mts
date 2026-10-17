// Types for the pure parts of pr-watch.mjs, so test/pr-watch.test.ts can import them.

export interface Snapshot {
  state: string;
  head: string;
  mergeable: string;
  reviewDecision: string | null;
  reviews: { id: number; state: string; body: string; author?: string; trusted: boolean; commit?: string }[];
  threads: { id: string; resolved: boolean; path: string; last?: { id: number; body: string; author?: string; trusted: boolean } }[];
  comments: { id: number; body: string; author?: string; trusted: boolean }[];
  rollup: string;
  checks: { name: string; done: boolean; failed: boolean }[];
}

export interface Seen {
  reviews: number[];
  comments: number[];
  threadComments: number[];
}

export interface WatchEvent {
  kind: string;
  [key: string]: unknown;
}

export const AGENT_MARK: string;
export function trusted(association: string | undefined, login: string | undefined): boolean;
export function idsOf(snap: Snapshot): Seen;
export function events(now: Snapshot, seen: Seen): WatchEvent[];
