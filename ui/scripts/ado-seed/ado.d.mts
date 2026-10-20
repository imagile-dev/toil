import type { SeedRecord } from './generate.mjs';
export const API: string;
export const IDENTITIES: string[];
export const TITLE_PREFIX: string;
export class SeedError extends Error { fix: string; constructor(message: string, fix: string) }
export interface AdoItem { id: number; rev?: number; fields: Record<string, any>; relations?: Array<{ rel: string; url: string; attributes?: Record<string, unknown> }> }
export interface Client {
  project: string;
  workItemUrl(id: number): string;
  me(): Promise<string>;
  projectInfo(): Promise<any>;
  iterations(): Promise<any>;
  tags(): Promise<string[]>;
  wiql(query: string): Promise<number[]>;
  getMany(ids: number[]): Promise<AdoItem[]>;
  create(type: string, ops: unknown[], bypass?: boolean): Promise<AdoItem>;
  update(id: number, ops: unknown[], bypass?: boolean): Promise<AdoItem>;
  remove(id: number): Promise<unknown>;
}
export function connectionFromEnv(env?: Record<string, string | undefined>): { baseUrl: string; pat: string };
export function client(options: { baseUrl: string; pat: string; project: string; fetch?: typeof fetch }): Client;
export function candidateQuery(identity: string): string;
export function seedKey(item: AdoItem, identity: string, project: string): string | null;
export function findSeeded(api: Client, identity: string): Promise<{ seeded: Map<string, AdoItem>; refused: number[] }>;
export function projectPath(path: string, project: string): string;
export function keyOf(id: string): string;
export function createPatch(record: SeedRecord, options: { project: string; identity: string; me: string | null; existingTags: Set<string> }): { ops: Array<{ op: string; path: string; value: any }>; skippedTags: string[] };
export function missingLinks(record: SeedRecord, item: { relations?: AdoItem['relations'] }, idOf: (key: string) => number | undefined, workItemUrl: (id: number) => string): Array<{ op: string; path: string; value: any }>;
export function statesOf(record: SeedRecord): string[];
export function remainingStates(record: SeedRecord, current: string): string[] | null;
