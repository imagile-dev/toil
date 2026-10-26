/**
 * The commands the views read: data only, kept apart from the Store that runs
 * them (ui/server/store.ts holds the read-only lock) so that adding a read is a
 * change to a list and nothing else. Triage may edit this file
 * (scripts/triage/changes.mjs); it may not edit the Store.
 */

/**
 * The readiness gate's live reads (#307): an item's workflow, read on a
 * person's press from its page. A sync never stores them, so the cache passes
 * them to toil, read-only, like the dossiers.
 */
export const WORKFLOW_READS = ['jira issue transitions', 'jira-cloud issue transitions', 'ado work-item states', 'ado-cloud work-item states'] as const;

/**
 * The commands the views read, and the only ones `/api/execute` runs. They are
 * the calls src/load.ts makes; test/server.test.ts holds this list to every
 * call the fixture answers, so a new panel's command is added here on purpose.
 */
export const READ_COMMANDS: ReadonlySet<string> = new Set([
  'dossiers list',
  'dossiers show',
  'jira issue search',
  'jira issue history',
  'jira-cloud issue search',
  'jira-cloud issue history',
  'ado work-item iterations',
  'ado work-item search',
  'ado work-item get-many',
  'ado work-item history',
  'ado pr list',
  'ado pr get',
  'ado run list',
  'ado-cloud work-item iterations',
  'ado-cloud work-item search',
  'ado-cloud work-item get-many',
  'ado-cloud work-item history',
  'ado-cloud pr list',
  'ado-cloud pr get',
  'github project items',
  'github issue get',
  'github issue list',
  'github issue history',
  'github pr list',
  'github pr get',
  'github repo file',
  'bitbucket pr list',
  'bitbucket pr get',
  'bitbucket-cloud pr list',
  'bitbucket-cloud pr get',
  'jenkins pipeline runs',
  'openshift deployment list',
  // The readiness gate's one live read (#307): an item's workflow, on a person's press.
  ...WORKFLOW_READS,
]);
