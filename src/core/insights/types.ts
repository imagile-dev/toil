/**
 * Work insights' shapes (#567, docs/work-insights-proposal.md, Layer 2): a
 * pivot is one measure, split by one dimension, across time or a second
 * dimension, under filters. `toil projects pivot`, Toil UI's charts and the
 * agent tool `insights_pivot` all run the same `pivot()` over Open Work Items,
 * so a number on a screen is the number an agent gets from the CLI. Everything
 * here is data and every function beside it is pure: no clock, no file, no
 * network. A figure nobody read is `null`, never 0 (principle 12), because a
 * dashboard that rounds ignorance down to zero is how a steering committee
 * comes to believe there are no bugs.
 */

import type { Change, WorkItem } from '../owi/types.js';

// Dimensions ---------------------------------------------------------------

/**
 * A dimension, as `--split`, `--across` and `--where` name it: a base name
 * and, for some, an argument after a colon.
 *
 * Single-valued: `category`, `type`, `statusCategory`, `status`, `priority`,
 * `assignee`, `team`, `iteration` (the current sprint), `project` (the key's
 * project or repository), `tracker` (the area), `connection`,
 * `area` or `area:<depth>` (an Azure DevOps area path cut at a depth, default 2).
 *
 * Parent: `parent` (the direct parent), `parent:top` (the top of the tree),
 * `parent:<TypeName>` (the nearest ancestor whose tracker type name or OWI
 * type matches, case-insensitive: `parent:Epic`, `parent:Feature`).
 *
 * Multi-valued (an item counts once in each value it holds): `label`,
 * `label:<prefix>` (a label family: the labels starting with the prefix, shown
 * without it), `component`, `release`, `affects`, `sprint` (every sprint the
 * item was in), `dim:<name>` (a dimension the toil project names).
 *
 * Time: `created`, `started`, `resolved`, each with `:week`, `:month` or
 * `:quarter` (default `:week`). `started` is the first move into IN_PROGRESS
 * in the item's history.
 *
 * Derived by code: `age` (buckets of days since started, open items),
 * `size` (buckets of estimate), `planned` (planned / unplanned: added to its
 * sprint after the sprint started, or an INCIDENT), `hasEpic`, `carried`
 * (was in more than one sprint), `reopened` (left DONE at least once).
 */
export type DimensionSpec = string;

export const DIMENSION_BASES = [
  'category', 'type', 'statusCategory', 'status', 'priority', 'assignee', 'team', 'iteration', 'project', 'tracker', 'connection', 'area',
  'parent',
  'label', 'component', 'release', 'affects', 'sprint', 'dim',
  'created', 'started', 'resolved',
  'age', 'size', 'planned', 'hasEpic', 'carried', 'reopened',
] as const;
export type DimensionBase = (typeof DIMENSION_BASES)[number];

export const TIME_GRAINS = ['week', 'month', 'quarter'] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];

/** A parsed dimension. `parseDimension` in dimensions.ts builds one from a spec, or throws a plain Error naming what is wrong. */
export interface Dimension {
  spec: DimensionSpec;
  base: DimensionBase;
  /** The part after the colon, as written: a depth, a prefix, a type name, a grain, a dimension's name. */
  arg: string | null;
  kind: 'single' | 'parent' | 'multi' | 'time' | 'derived';
  /** Plain words for a menu or an axis: "Release", "Parent › Epic", "Created, by month". */
  label: string;
  /** What the "none" bucket is called: "No fix version", "Unassigned", "Unclassified", "No epic". Time dimensions have none. */
  noneLabel: string | null;
}

/** The key every "none" bucket uses, and the key of the folded rest. Neither can be a real value's key: real keys are prefixed `v:`. */
export const NONE_KEY = '(none)';
export const OTHER_KEY = '(other)';

/**
 * What one item holds in one dimension.
 * - `unread`: the read never fetched it (the OWI field is absent, the item has no history, no scheme was given). The item goes in no bucket.
 * - `values: []`: it was read and the item has none; the item goes in the "none" bucket.
 */
export type DimensionValues = { unread: true } | { unread: false; values: Array<{ key: string; label: string; /** For a category: its short form. */ short?: string; /** Sort position for a time bucket or an ordered one (ISO date of the bucket's start, or a rank). */ order?: string }> };

// Measures -----------------------------------------------------------------

/**
 * - `items`: how many items.
 * - `estimate`: the sum of estimates, in the unit most items use; items with none are left out and counted in coverage.
 * - `days`: person-days in progress inside the period, from status history: each working day (Mon-Fri, UTC) a person had
 *   items IN_PROGRESS is one day, split evenly across the items they had in progress that day.
 * - `throughput`: items resolved (DONE with a `resolved` date) inside the period.
 * - `cycleTime`: days from started to resolved, for items resolved inside the period; the cell's value is the median, `p85` beside it.
 * - `wip`: items IN_PROGRESS as of `asOf`.
 * - `aging`: days since started for items IN_PROGRESS as of `asOf`; the median, with `p85`.
 */
export const MEASURES = ['items', 'estimate', 'days', 'throughput', 'cycleTime', 'wip', 'aging'] as const;
export type MeasureId = (typeof MEASURES)[number];

export type MeasureUnit = 'items' | 'points' | 'hours' | 'days' | 'person-days';

// A pivot -------------------------------------------------------------------

/** One filter: the item must (or must not) hold one of the values, compared case-insensitively against a value's label or key. `none` matches the "none" bucket. */
export interface Filter {
  dimension: DimensionSpec;
  op: '=' | '!=';
  values: string[];
}

/** What to compute. This is also what a saved view stores, and what Toil UI keeps in the address. */
export interface PivotSpec {
  measure: MeasureId;
  split?: DimensionSpec;
  across?: DimensionSpec;
  where?: Filter[];
  /** The period, as days (`YYYY-MM-DD`), inclusive. Time measures and time dimensions read it; default: the 90 days up to `asOf`. */
  from?: string;
  to?: string;
  /** Add each cell's share of its column's total (0 to 1). */
  share?: boolean;
  /** How many split values keep their own row before the rest fold into "Other" (default 4; 0 keeps all). */
  top?: number;
  /** Split values (by label) that always keep a row, in this order, ahead of the largest. */
  pin?: string[];
  /** When splitting by a parent dimension, parents are left out of the measure (their children carry the work). True puts them back. */
  includeParents?: boolean;
}

/** A view a team keeps in its toil project (`views.<name>`), so everyone opens the same chart. */
export interface SavedView extends PivotSpec {
  title?: string;
  /** The chart form to open on; without one the form follows the data. */
  chart?: 'columns' | 'bars' | 'area' | 'line' | 'heatmap' | 'table';
}

/** A view's name in a toil project, and its limits. */
export const VIEW_NAME = /^[a-z][a-z0-9-]{0,40}$/;
export const MAX_VIEWS = 50;

/** One person, as a toil project lists them: the `team` dimension matches an item's assignee against `ids`, `email` and `name`. */
export interface InsightsPerson {
  name: string;
  team?: string;
  email?: string;
  ids?: Record<string, string>;
}

/** What a category is called, for the `category` dimension's labels. */
export interface InsightsCategory {
  id: string;
  name: string;
  short: string;
}

export interface PivotInput {
  items: WorkItem[];
  /** Pull requests in the same input; no measure reads them yet, and they are counted so coverage can say so. */
  changes?: Change[];
  spec: PivotSpec;
  /** The moment figures are counted to, ISO 8601. Never read from a clock in here. */
  asOf: string;
  /** The toil project's people, for `team`. Without it, `team` falls back to each item's own `team` field. */
  people?: InsightsPerson[];
  /**
   * Each item's category id by OWI id, with null for an item that was looked at and left unsure. An item missing from the
   * map was never classified, so its category is unread. Without the map the whole `category` dimension is unread.
   */
  categories?: Record<string, string | null>;
  /** The scheme's categories, in the scheme's order, so they keep their marks and their plain names. */
  scheme?: { name: string; revision: number; categories: InsightsCategory[] };
}

/** One row or column of the table. */
export interface PivotAxisValue {
  key: string;
  label: string;
  kind: 'value' | 'other' | 'none';
  /** For a category: its short form ("KTLO"), so a tooltip can say "Keep the lights on (KTLO)". */
  short?: string;
}

/**
 * One cell. `value` is null when the measure could not be computed for it
 * (no item in it carries an estimate, no item has a history), and `reason`
 * says why; it is 0 only when the cell was computed and holds nothing.
 */
export interface PivotCell {
  value: number | null;
  /** The 85th percentile, for `cycleTime` and `aging`. */
  p85?: number | null;
  /** The share of the column's total, when `share` was asked for; null where the total is null or 0. */
  share?: number | null;
  /** The OWI ids behind the cell, so every number is a door. */
  items: string[];
  /** How many of the cell's items the measure could read, of how many it holds. */
  measured: number;
  of: number;
  reason?: string;
}

export interface PivotCoverage {
  /** Items in the input, after filters, and how many the measure could read. */
  items: number;
  measured: number;
  /** Items left out of the table because the split or the across dimension was never read for them. */
  unreadSplit: number;
  unreadAcross: number;
  /** Items left out because they are parents (see `includeParents`). */
  parentsLeftOut: number;
  /** True when the split or the across holds several values per item, so an item can count more than once and rows don't sum to the total. */
  multi: boolean;
  /** Sentences a screen shows under the chart, in plain words: what was left out and why. */
  notes: string[];
}

/** A change worth a person's attention, worked out by code so an AI agent explains it rather than discovers it. */
export interface Notable {
  kind: 'share-moved' | 'scope-added' | 'grew-fastest';
  /** The row and column keys it points at; a cell citation is `[[cell:<column>/<row>]]`. */
  row: string;
  column: string;
  /** One sentence with the figures in it. */
  message: string;
  /** The size of the move: share points (0 to 1) or a ratio. */
  delta: number;
  items: string[];
}

/** A share that moves this many points against the previous period is notable; so is scope that grows by this ratio. */
export const NOTABLE_SHARE_POINTS = 0.1;
export const NOTABLE_SCOPE_RATIO = 0.1;

export interface PivotResult {
  spec: PivotSpec;
  asOf: string;
  period: { from: string; to: string };
  measure: { id: MeasureId; unit: MeasureUnit; label: string };
  /** Null when there is no split: the table then has one row, key `(all)`. */
  split: (Pick<Dimension, 'spec' | 'label' | 'kind'> & { read: boolean }) | null;
  /** Null when there is no across: the table then has one column, key `(all)`. */
  across: (Pick<Dimension, 'spec' | 'label' | 'kind'> & { read: boolean }) | null;
  rows: PivotAxisValue[];
  columns: PivotAxisValue[];
  /** `cells[row][column]`. */
  cells: PivotCell[][];
  /** One total per row and per column, and the grand total; each counts an item once however many values it holds. */
  rowTotals: PivotCell[];
  columnTotals: PivotCell[];
  total: PivotCell;
  /** Every split value before folding, largest first, so "Other" can be opened. */
  allValues: Array<{ key: string; label: string; value: number | null; items: number }>;
  coverage: PivotCoverage;
  notable: Notable[];
}

export const ALL_KEY = '(all)';
