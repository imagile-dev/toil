/**
 * The Store: where the server gets what a view shows (#206, Hosting-ready by
 * design). The SPA reads through one seam, toil's own `execute()` signature
 * (src/toil.ts), so a Store answers toil calls. Two ship beside each other and
 * one is chosen at startup:
 *
 * - `toilStore`: toil itself, in-process through `@imagile-dev/toil/api`, with
 *   the user's own connections and dossiers. Every call is `caller: 'toil-ui'`
 *   in the audit log.
 * - `fixtureStore`: the preview's fixture `execute()` and its sample data, for
 *   `toil-ui --sample` and the tests.
 *
 * The SQLite cache (#250) is a third, answering the same calls from what a
 * sync stored. The server, not the Store, decides what a call may do: a read
 * from `READ_COMMANDS` always goes `readOnly`, a config change only for a
 * command in the server's config allowlist (#253), and anything else is
 * refused before a Store sees it. Two locks on one door, and both keys stay
 * with the tenant.
 */

import { FIXTURE_NOW, fixtureExecute } from '../src/fixtures/execute.ts';
import type { Envelope, Execute } from '../src/toil.ts';
import type { RequestContext } from './context.ts';

/** What a call is allowed to do. `read` is every view; `config` is #253's settings pages, and nothing else. */
export type Access = 'read' | 'config';

export interface Store {
  /** `toil`, `fixture`, and later `sqlite`: shown in the session, so a view can say where its data came from. */
  readonly kind: string;
  /** Sample data: the views carry the preview banner. */
  readonly sample: boolean;
  /** The moment the views work their figures out at: now, or the sample's fixed day. */
  now(): string;
  /**
   * Runs one toil call for the viewer and returns its envelope; never throws.
   * `access` is the server's decision, already checked against its
   * allowlists: `read` must run read-only.
   */
  execute(ctx: RequestContext, command: string, input: Record<string, unknown>, access: Access): Promise<Envelope>;
}

/**
 * The commands the views read, and the only ones `/api/execute` runs. They are
 * the calls src/load.ts makes; test/server.test.ts holds this list to every
 * call the fixture answers, so a new panel's command is added here on purpose.
 */
export const READ_COMMANDS: ReadonlySet<string> = new Set([
  'dossiers list',
  'dossiers show',
  'jira search',
  'jira get-changelog',
  'ado work list-iterations',
  'ado work search',
  'ado work get-batch',
  'ado work revisions',
  'ado repo list-prs',
  'ado pipeline list-runs',
  'github projects list-items',
  'github get-issue',
  'github issue-events',
  'github list-prs',
  'github list-checks',
  'bitbucket list-prs',
  'jenkins pipeline list-runs',
  'openshift deployments',
]);

/** Every Toil UI call names itself, so the audit log says which lines were the UI's. */
export const CALLER = 'toil-ui';

/** toil's own `execute()`, read-only for every read; `config` calls go through toil's write rules unchanged. */
export function toilStore(execute: Execute): Store {
  return {
    kind: 'toil',
    sample: false,
    now: () => new Date().toISOString(),
    execute: (ctx, command, input, access) => execute(command, input, { readOnly: access === 'read', caller: CALLER, signal: ctx.signal }),
  };
}

/** The preview's fixture `execute()`. It answers read-only calls only, so a `config` call comes back refused. */
export function fixtureStore(): Store {
  const fixture = fixtureExecute();
  return {
    kind: 'fixture',
    sample: true,
    now: () => FIXTURE_NOW,
    execute: (ctx, command, input, access) => fixture.execute(command, input, { readOnly: access === 'read', caller: CALLER, signal: ctx.signal }),
  };
}
