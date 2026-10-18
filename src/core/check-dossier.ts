import type { CommandContext } from './context.js';
import type { DossierView } from './dossier.js';
import { ToilError } from './errors.js';

/**
 * What every `toil <area> check-dossier` shares: finding the call's dossier,
 * looking each value up on the service, and the result's shape. Each area
 * says only which keys to look up and how. A command talks to one service,
 * so a dossier is checked one area at a time and the caller composes them
 * (principle 3). Inspection is by appointment, one department per visit.
 */
export interface DossierCheck {
  /** Where in the dossier the value is, e.g. `jira.projects[1]`. */
  path: string;
  /** What it was looked up as: `project`, `field`, `space`. */
  kind: string;
  value: string;
  found: boolean;
}

/**
 * The call's dossier, as this area sees it, for the call's environment only:
 * the area's own section, plus the section of the environment the call is in
 * (its `--env`, else the dossier's). Another environment's section may select
 * another connection, so it's checked by a call in that environment, never
 * against this one's server. INVALID_INPUT when no dossier applies.
 */
export function dossierToCheck(ctx: CommandContext<unknown, Record<string, string | undefined>>, area: string): DossierView {
  const view = ctx.dossierView();
  if (!view) {
    throw new ToilError('INVALID_INPUT', 'No dossier applies to this call, so there is nothing to check.', {
      fix: `Pass --dossier <name>, or run it in one of the dossier's repositories (toil dossiers context shows what this folder resolves to). Then toil ${area} check-dossier checks its ${area} section.`,
    });
  }
  const env = ctx.context.env ?? view.env;
  return { ...view, env, sections: view.sections.filter((s) => s.env === null || s.env === env) };
}

/**
 * Looks each distinct value up once, in order. `exists` returns false for a
 * value the service doesn't have; it throws for anything else (a bad token,
 * an unreachable host), which fails the check rather than calling every value
 * missing.
 */
export async function checkEach(items: ReadonlyArray<{ path: string; value: string }>, kind: string, exists: (value: string) => Promise<boolean>): Promise<DossierCheck[]> {
  const seen = new Map<string, boolean>();
  const out: DossierCheck[] = [];
  for (const item of items) {
    if (!seen.has(item.value)) seen.set(item.value, await exists(item.value));
    out.push({ path: item.path, kind, value: item.value, found: seen.get(item.value)! });
  }
  return out;
}

/** True for a NOT_FOUND from the service, the one failure that means "the value isn't there". */
export function notFound(err: unknown): boolean {
  return err instanceof ToilError && err.code === 'NOT_FOUND';
}

/** A lookup that is one GET: true when it answers, false on NOT_FOUND, and anything else fails the check. */
export function exists(get: () => Promise<unknown>): Promise<boolean> {
  return get().then(
    () => true,
    (err: unknown) => {
      if (notFound(err)) return false;
      throw err;
    },
  );
}

/** The result: which dossier, which connection, and every check. A missing value makes `ok` false and the CLI exit 1. */
export function dossierCheckResult(ctx: CommandContext<{ name: string } | undefined>, view: DossierView, checks: DossierCheck[]) {
  const ok = checks.every((c) => c.found);
  if (!ok) ctx.setExitCode(1);
  return { dossier: { name: view.name, source: view.source, file: view.file }, connection: ctx.connection?.name ?? null, env: view.env, ok, checked: checks.length, checks };
}
