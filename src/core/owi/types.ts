/**
 * The Open Work Item (OWI) model, version 0.2, as TypeScript: one work item
 * from Jira, Azure DevOps or GitHub in one shape, and since 0.2 one change
 * (a pull request) from GitHub, Bitbucket or Azure DevOps in another.
 * docs/owi/spec.md is the specification and docs/owi/schema.json the JSON
 * Schema every mapped record is checked against; these types follow both.
 * Additive changes only, and every record says which version it is (`owi`).
 * Three trackers, one form, which is more than most standardisation
 * programmes manage before the steering group.
 */

export const OWI_VERSION = '0.2' as const;

/** How a source's records are read: one mapper per shape, shared by every area that sends it. */
export type OwiFamily = 'jira' | 'ado' | 'github' | 'bitbucket' | 'bitbucket-cloud';

/** The commands of one area whose output maps, without the area's name (`issue search`, `work-item get-many`, `pr list`). */
export interface OwiSource {
  family: OwiFamily;
  items: string[];
  history: string[];
  context: string[];
  /** The pull request commands, mapped to `Change` records (0.2). */
  changes: string[];
}

const PRS = ['pr list', 'pr get'];
const JIRA: OwiSource = { family: 'jira', items: ['issue search', 'issue get'], history: ['issue history'], context: [], changes: [] };
const ADO: OwiSource = { family: 'ado', items: ['work-item get', 'work-item get-many'], history: ['work-item history'], context: ['work-item iterations'], changes: PRS };
const GITHUB: OwiSource = { family: 'github', items: ['issue list', 'issue search', 'issue get', 'project items'], history: ['issue history'], context: [], changes: PRS };
const BITBUCKET: OwiSource = { family: 'bitbucket', items: [], history: [], context: [], changes: PRS };

/**
 * The areas toil maps to OWI. An area that sends one of these shapes is one
 * line here: `jira` and `ado` serve both their deployments from one mapper, and
 * `bitbucket` has one per deployment (its connection's deployment picks, since
 * their shapes differ in almost every field).
 */
export const OWI_SOURCES: Record<string, OwiSource> = {
  jira: JIRA,
  ado: ADO,
  github: GITHUB,
  bitbucket: BITBUCKET,
};
export const OWI_AREAS = Object.keys(OWI_SOURCES);
export type OwiArea = string;

export type WorkItemType = 'EPIC' | 'STORY' | 'TASK' | 'BUG' | 'INCIDENT' | 'OTHER';
export type StatusCategory = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'UNKNOWN';
export type EstimateUnit = 'points' | 'hours' | 'days';
export type LinkType = 'blocks' | 'relates' | 'duplicates' | 'implements' | 'other';

export interface Person {
  id: string;
  name: string | null;
  email: string | null;
}

export interface Estimate {
  value: number;
  unit: EstimateUnit;
  /** The source field the value came from. */
  field: string;
}

export interface Iteration {
  id: string | null;
  name: string;
  path: string | null;
  start: string | null;
  end: string | null;
  state: 'past' | 'current' | 'future' | null;
}

export interface Link {
  type: LinkType;
  /** outward: this item <type> the target. inward: the target <type> this item. */
  direction: 'outward' | 'inward';
  target: string;
  /** The source's own wording. */
  name: string;
}

export interface Transition {
  from: string | null;
  to: string;
  fromCategory: StatusCategory | null;
  toCategory: StatusCategory;
  at: string;
  by: Person | null;
}

export interface IterationChange {
  from: string[];
  to: string[];
  at: string;
  by: Person | null;
}

export interface History {
  transitions: Transition[];
  iterations: IterationChange[];
}

/**
 * A release, or a version an item affects: Jira's fix and affects versions,
 * a GitHub milestone, and a field an Azure DevOps toil project names.
 * `released` is null where the source can't say (a text field), and `date` is
 * the day the release is due or went out, null when it has none.
 */
export interface Release {
  id: string | null;
  name: string;
  released: boolean | null;
  date: string | null;
  /**
   * Optional. The day (`YYYY-MM-DD`) work on the release started, where the source says
   * (Jira's version `startDate`); null when the source carries the field but it is empty.
   * Absent: the source has no such field, or the read never fetched it.
   */
  start?: string | null;
}

/** One level of an item's parent chain, as `ancestors` holds it, nearest parent first. */
export interface Ancestor {
  id: string;
  type: WorkItemType;
  typeName: string | null;
  title: string;
}

/** An Azure DevOps area path (`Imagile\Payments\Web`), kept whole so a split can cut it at any depth. */
export interface AreaPath {
  path: string;
}

/**
 * The extra dimensions a toil project names, `dimensions` in its file: a
 * dimension's name to the field that holds it in each area (`{ customer: {
 * jira: 'customfield_10500', ado: 'Custom.Customer' } }`). A caller hands it
 * to the mapper the way it hands field overrides; no mapper reads a toil
 * project.
 */
export type DimensionMap = Record<string, Record<string, string>>;

export interface Unmapped {
  field: string;
  reason: string;
}

export interface Body {
  format: 'markdown' | 'wiki' | 'adf' | 'html';
  content: string | Record<string, unknown>;
}

/** One comment on a work item, as a stand-up reads it: who wrote it, when, and its text as plain text on one line. */
export interface Comment {
  id: string;
  author: Person | null;
  /** UTC, as `toISOString` writes it. */
  at: string;
  /** Plain text, markup taken out, capped; never HTML. */
  text: string;
  /** A link to the comment where the tracker gives one, else null. */
  url: string | null;
}

export interface WorkItem {
  owi: typeof OWI_VERSION;
  id: string;
  source: { area: OwiArea; connection: string; key: string; command: string; deployment?: string };
  url: string | null;
  type: WorkItemType;
  typeName: string | null;
  title: string;
  body: Body | null;
  status: string | null;
  statusCategory: StatusCategory;
  resolution: string | null;
  assignee: Person | null;
  reporter: Person | null;
  priority: string | null;
  estimate: Estimate | null;
  labels: string[];
  team: string | null;
  iteration: Iteration | null;
  parent: string | null;
  children: string[];
  links: Link[];
  created: string | null;
  updated: string | null;
  resolved: string | null;
  dueDate: string | null;
  history: History | null;
  unmapped: Unmapped[];
  native: Record<string, unknown>;
  /*
   * The fields people split work by. All optional, and for all of them absent
   * means the read never fetched it (a Jira search that didn't ask for
   * fixVersions); an empty list, or null for `area`, means it was read and the
   * item has none. A missing key is never the same as an empty one.
   */
  /** Fix versions (Jira), the milestone (GitHub), or the field `fields release` names (Azure DevOps). */
  releases?: Release[];
  /** Affected versions: Jira's `versions`, or the field `fields affects` names (Azure DevOps). */
  affects?: Release[];
  /** Jira components, by name. */
  components?: string[];
  /** Azure DevOps' area path; null when the record carries none. */
  area?: AreaPath | null;
  /** Every sprint or iteration the item has been in, where the source lists them; `iteration` stays the current one. */
  sprints?: Iteration[];
  /** The values of each dimension a toil project names, by dimension name; a value is always a list, since a field may hold several. */
  dims?: Record<string, string[]>;
  /** The parent chain among the records mapped together, nearest first. It ends where a parent isn't in the input. */
  ancestors?: Ancestor[];
  /** The comments the read returned, oldest first, the newest 20 at most. Absent: not read (a Jira search that didn't ask for `comment`). []: read, none. */
  comments?: Comment[];
}

/** A history mapped for an item that wasn't in the same input. */
export interface OrphanHistory {
  id: string;
  history: History;
}

/**
 * The OWI fields a team can point at a field of its own, with `fields`, and
 * two settings for a GitHub repository run without a board: `estimateLabel`,
 * the label pattern that holds an estimate (`points: {n}`), and
 * `iterationDays`, how long a milestone's sprint runs.
 */
export const OVERRIDABLE = ['estimate', 'estimateUnit', 'priority', 'type', 'team', 'dueDate', 'iteration', 'release', 'affects', 'estimateLabel', 'iterationDays'] as const;
export type Overridable = (typeof OVERRIDABLE)[number];
export type FieldOverrides = Partial<Record<Overridable, string>>;

// Changes (0.2) -----------------------------------------------------------------

export type ChangeState = 'OPEN' | 'MERGED' | 'DECLINED' | 'DRAFT';
export type ReviewerState = 'APPROVED' | 'CHANGES_REQUESTED' | 'PENDING';
export type ReviewState = 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
export type ChecksState = 'PASSING' | 'FAILING' | 'PENDING' | 'NONE';
export type AuthorKind = 'HUMAN' | 'AGENT' | 'BOT';
/** Which signal set `authorKind`: never a guess, and `default` when there was none. */
export type AuthorKindSource = 'override' | 'account' | 'trailer' | 'branch' | 'default';
export const AUTHOR_KINDS: readonly AuthorKind[] = ['HUMAN', 'AGENT', 'BOT'];

/** Someone asked to review, and where their review stands now. */
export interface Reviewer {
  person: Person;
  state: ReviewerState;
}

/** One review as it happened: an approval, a request for changes, a comment, or an approval withdrawn. */
export interface Review {
  by: Person;
  state: ReviewState;
  at: string;
}

export interface ChangeSize {
  files: number | null;
  additions: number | null;
  deletions: number | null;
}

/** A pull request, as OWI 0.2 models it: the change that carries work, not the work. */
export interface Change {
  owi: typeof OWI_VERSION;
  /** `<connection>:<repo>#<number>`: `github:imagile/payments-web#41`, `corp-bitbucket:PAY/payments-core#311`. */
  id: string;
  source: { area: OwiArea; connection: string; key: string; command: string; deployment?: string };
  url: string | null;
  /** The repository as the source names it: `owner/repo`, `PROJECT/slug`, `workspace/slug`, `project/repo`. */
  repo: string;
  title: string;
  branch: { source: string | null; target: string | null };
  state: ChangeState;
  author: Person | null;
  authorKind: AuthorKind;
  authorKindSource: AuthorKindSource;
  /** What the signal was, in words (`account type Bot`, a Co-Authored-By trailer, `branch claude/fix-retries`); null for the default. */
  authorKindSignal: string | null;
  reviewers: Reviewer[];
  /** Every review in order, or null when the input held none (a list, or a get without its reviews). */
  reviews: Review[] | null;
  /** The checks on the latest commit, rolled up; null when they weren't read. */
  checks: ChecksState | null;
  /** When the checks came to their state: for FAILING, the earliest finish of a check failing now; otherwise the latest check. */
  checksAt: string | null;
  /** Whether it merges cleanly: false is a conflict; null when the source didn't say. */
  mergeable: boolean | null;
  size: ChangeSize | null;
  /** The OWI ids of the work items its title, branch and description name. */
  workItems: string[];
  /** For a merged change: the commit it merged as. */
  mergeCommit: string | null;
  created: string | null;
  firstReviewAt: string | null;
  approvedAt: string | null;
  mergedAt: string | null;
  closedAt: string | null;
  updated: string | null;
  unmapped: Unmapped[];
  native: Record<string, unknown>;
}

/**
 * A key pattern: text with `{n}` where the number is, and the connection the
 * key belongs to. The key is the text matched (`PAY-{n}` finds `PAY-101`;
 * `imagile/payments-web#{n}` finds `imagile/payments-web#42`), except that a
 * mention ending `#{n}` with no repository in it names the number alone
 * (`AB#{n}`, Azure Boards' mention, finds key `2302`).
 */
export interface KeyPattern {
  text: string;
  connection: string;
}

export interface OwiWarning {
  code: string;
  message: string;
}
