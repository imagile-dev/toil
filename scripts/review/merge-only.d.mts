// Types for merge-only.mjs, so test/merge-only.test.ts can import it.

export type Git = (args: string[], options?: { allowFail?: boolean }) => string | null;
export type CheckResult = { ok: true; [key: string]: unknown } | { ok: false; reason: string };

export interface Review { id: number; state: string; commit_id?: string; user?: { login: string } }
export interface TimelineEvent {
  event: string;
  dismissed_review?: { review_id: number; state: string; dismissal_message: string | null; dismissal_commit_id: string | null };
}

export interface GitHub {
  get(path: string): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  list(path: string): Promise<unknown[]>;
  graphql(query: string, variables: Record<string, unknown>): Promise<unknown>;
}

export interface Outcome {
  approved: boolean;
  reason: string;
  checks: { name: string; ok: boolean; detail: string }[];
}

export function gitIn(cwd: string): Git;
export function mergesOfBaseOnly(git: Git, approved: string, head: string, base: string): CheckResult;
export function prPatch(git: Git, base: string, commit: string): string;
export function samePrChange(git: Git, approved: string, head: string, base: string): CheckResult;
export function standingApproval(reviews: Review[], timeline: TimelineEvent[], bot: string): CheckResult;
export function github(options: { token: string; api?: string; fetcher?: typeof fetch }): GitHub;
export function openThreads(gh: GitHub, repo: string, number: number): Promise<number>;
export function approvalBody(approved: string, base: string, runUrl: string): string;
export function run(input: { env: Record<string, string | undefined>; gh: GitHub; git: Git; dryRun?: boolean }): Promise<Outcome>;
export function summary(outcome: Outcome): string;
