/**
 * The two seams Toil UI is built around (#206, Hosting-ready by design): a
 * `Store` that holds synced work items and an `Agent` that reasons over them.
 * The views know only these interfaces. The site preview runs them on a fixture
 * Store and a scripted Agent (src/fixtures/), which are also the UI's test
 * harness; the local app will put a SQLite cache and a real agent adapter
 * behind the same shapes. Two interfaces, no implementation yet: the
 * architecture review board signed it off in record time.
 */

import type { WorkItem } from '../../src/core/owi/types.ts';

export type { Person, StatusCategory, WorkItem, WorkItemType } from '../../src/core/owi/types.ts';

/** The trackers and code hosts a preview or a sync reads from. */
export type SourceKind = 'jira' | 'ado' | 'github' | 'bitbucket' | 'jenkins';

export interface SourceInfo {
  /** The toil connection name, the first part of every OWI id from it. */
  connection: string;
  kind: SourceKind;
  /** What the source holds, in its own words: a project, a repository. */
  scope: string;
}

export interface SyncInfo {
  /** When the data was last synced. Every view shows it (principle 4). */
  syncedAt: string;
  sources: SourceInfo[];
  /** Set when the data is sample data, with what it is. */
  sample: string | null;
}

/**
 * A pull request, commit or build that mentions a work item's key: how code
 * hosts and pipelines join the picture (#206, `ChangeRef`). OWI 0.1 leaves them
 * out (docs/owi/spec.md says a later version will carry them), so this is the
 * UI's own shape until it does.
 */
export interface ChangeRef {
  id: string;
  kind: 'pull-request' | 'commit' | 'build';
  source: SourceInfo['kind'];
  /** The OWI ids of the work items it mentions. */
  items: string[];
  title: string;
  url: string;
  /** The source's own state word: OPEN, MERGED, SUCCESSFUL, failed. */
  state: string;
  /** The state, sorted into what the views need. */
  outcome: 'open' | 'merged' | 'declined' | 'passed' | 'failed' | 'running';
  /** For a build: the pull request or commit it built. */
  builds: string | null;
  at: string;
}

export interface Store {
  info(): Promise<SyncInfo>;
  items(): Promise<WorkItem[]>;
  item(id: string): Promise<WorkItem | null>;
  changes(): Promise<ChangeRef[]>;
}
