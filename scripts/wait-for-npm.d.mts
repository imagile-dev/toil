// Types for wait-for-npm.mjs, so test/wait-for-npm.test.ts can import it.

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface Answer {
  served: boolean;
  detail: string;
}

export const DEFAULT_WAIT_SECONDS: number;
export function delayAfter(attempt: number): number;
export function packumentUrl(registry: string, pkg: string): string;
export function duration(seconds: number): string;
export function waitSecondsFrom(env: Record<string, string | undefined>): number;
export function check(pkg: string, version: string, opts: { registry: string; fetch: Fetch }): Promise<Answer>;
export function waitFor(
  pkg: string,
  version: string,
  opts: { registry: string; fetch: Fetch; waitSeconds: number; log: (line: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<Answer & { attempts: number }>;
