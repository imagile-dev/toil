import { vi } from 'vitest';

/**
 * Every env var that can define or change a toil connection on this machine:
 * each `TOIL_*` name set now, and each CI fallback the areas declare
 * (`GITHUB_TOKEN`, `SYSTEM_ACCESSTOKEN`, ...). A test that reads connections
 * stubs them all to undefined, so a runner or a developer's shell with
 * `GITHUB_TOKEN` set gets the same result as one without.
 */
export function connectionEnvVars(areas: ReadonlyArray<{ fallbacks?: Partial<Record<string, readonly string[] | undefined>> }>, env: NodeJS.ProcessEnv = process.env): string[] {
  const fallbacks = areas.flatMap((a) => Object.values(a.fallbacks ?? {}).flatMap((names) => [...(names ?? [])]));
  return [...new Set([...Object.keys(env).filter((name) => name.startsWith('TOIL_')), ...fallbacks])].sort();
}

/** Stubs every one of them to undefined for the current test; `vi.unstubAllEnvs()` puts them back. */
export function clearConnectionEnv(areas: Parameters<typeof connectionEnvVars>[0]): void {
  for (const name of connectionEnvVars(areas)) vi.stubEnv(name, undefined);
}
