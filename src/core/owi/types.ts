/**
 * The Open Work Item (OWI) model, version 0.1, as TypeScript: one work item
 * from Jira, Azure DevOps or GitHub in one shape. docs/owi/spec.md is the
 * specification and docs/owi/schema.json the JSON Schema every mapped item is
 * checked against; these types follow both. Additive changes only, and every
 * record says which version it is (`owi`). Three trackers, one form, which is
 * more than most standardisation programmes manage before the steering group.
 */

export const OWI_VERSION = '0.1' as const;

/** How a source's records are read: one mapper per shape, shared by every area that sends it. */
export type OwiFamily = 'jira' | 'ado' | 'github';

/** The commands of one area whose output maps, without the area's name (`search`, `work get-batch`). */
export interface OwiSource {
  family: OwiFamily;
  items: string[];
  history: string[];
  context: string[];
}

const JIRA: OwiSource = { family: 'jira', items: ['search', 'get-issue'], history: ['get-changelog'], context: [] };
const ADO: OwiSource = { family: 'ado', items: ['work get', 'work get-batch'], history: ['work revisions'], context: ['work list-iterations'] };
const GITHUB: OwiSource = { family: 'github', items: ['list-issues', 'search-issues', 'get-issue', 'projects list-items'], history: ['issue-events'], context: [] };

/**
 * The areas toil maps to OWI. An area that sends one of these shapes is one
 * line here: Data Center and Cloud variants share their family's mapper
 * (`jira-cloud`), and a cloud Azure DevOps area would be `'ado-cloud': ADO`.
 */
export const OWI_SOURCES: Record<string, OwiSource> = {
  jira: JIRA,
  'jira-cloud': JIRA,
  ado: ADO,
  github: GITHUB,
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

export interface Unmapped {
  field: string;
  reason: string;
}

export interface Body {
  format: 'markdown' | 'wiki' | 'adf' | 'html';
  content: string | Record<string, unknown>;
}

export interface WorkItem {
  owi: typeof OWI_VERSION;
  id: string;
  source: { area: OwiArea; connection: string; key: string; command: string };
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
}

/** A history mapped for an item that wasn't in the same input. */
export interface OrphanHistory {
  id: string;
  history: History;
}

/** The OWI fields a team can point at a field of its own, with `fields`. */
export const OVERRIDABLE = ['estimate', 'estimateUnit', 'priority', 'type', 'team', 'dueDate', 'iteration'] as const;
export type Overridable = (typeof OVERRIDABLE)[number];
export type FieldOverrides = Partial<Record<Overridable, string>>;

export interface OwiWarning {
  code: string;
  message: string;
}
