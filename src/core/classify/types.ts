/**
 * Work classification's shapes: the scheme a team sorts its work by, the
 * verdict each item gets, and the plan the trackers' `categorize` commands
 * apply. `toil classify run` writes a plan and never touches a tracker;
 * `toil <area> … categorize` reads one and never classifies (principle 3), so
 * this file is the whole of what the two halves agree on. Everything here is
 * data: no secret, host, connection setting or `writes` ever lives in a
 * scheme, a verdict or a plan. The categories are the team's own, which spares
 * everyone the working group on what "maintenance" means.
 */

/** The trackers whose items toil can classify and write a category back to. */
export const CLASSIFY_AREAS = ['jira', 'github', 'ado'] as const;
export type ClassifyArea = (typeof CLASSIFY_AREAS)[number];

/** A scheme's name is its file name (`<name>.json`), so it is held to one safe form. */
export const SCHEME_NAME = /^[a-z][a-z0-9-]{0,62}$/;
/** A category's id: what a verdict records and a rule's `then` names. */
export const CATEGORY_ID = /^[a-z][a-z0-9-]{0,30}$/;
/** What a verdict says when nothing settled the item. Never a category's id. */
export const UNSURE = 'unsure';
/**
 * A person's standing say on an item, as the engine takes it. `from` is the category the tracker held when the say was made, so a
 * label or field that still says it is the tracker not having caught up, and the say stands; absent where there is no such
 * thing to compare (a say with nothing before it, or one that came from the tracker itself). `via` says which door recorded it.
 */
export interface PersonSay {
  category: string;
  reason: string | null;
  from?: string | undefined;
  via?: 'cli' | 'mcp' | 'api' | 'tracker' | undefined;
}
/** The shape of a verdict's source; a ledger line holding anything else is a hand edit and is skipped, never printed. */
export const VERDICT_SOURCE = /^(?:label|field|parent|agent|person|unsure|rule:[a-z][a-z0-9-]{0,40}|signal:[a-z][a-z0-9-]{0,40})$/;
/** The scheme a toil project gets when it names none. */
export const DEFAULT_SCHEME = 'ktlo-feature';

/**
 * One category. `name` is the plain words a screen shows ("Keep the lights
 * on"), `short` the term of art one hover away ("KTLO") and the default value
 * of a tracker field, `label` the tracker label (plain, no space, since a Jira
 * label can't hold one), and `definition` what an agent is told it means.
 */
export interface Category {
  id: string;
  short: string;
  name: string;
  label: string;
  definition: string;
}

/** A worked example the prompt shows: an item's id and title only, never its body. */
export interface SchemeExample {
  item: string;
  title: string;
  category: string;
  why?: string;
}

/**
 * When a rule applies. Every key given must match, and a key matches when any
 * one of its values does:
 * - `parent`: the item sits under one of these, at any depth the input shows
 *   (an item's key, `PAY-100`, or its OWI id, `corp-jira:PAY-100`);
 * - `label`: the item carries one of these labels (case-insensitive);
 * - `type`: its OWI type (`BUG`) or the tracker's own type name (`Spike`),
 *   case-insensitive;
 * - `title`: its title contains one of these, case-insensitive.
 */
export interface RuleWhen {
  parent?: string[];
  label?: string[];
  type?: string[];
  title?: string[];
}
export const RULE_KEYS = ['parent', 'label', 'type', 'title'] as const;

export interface Rule {
  id: string;
  when: RuleWhen;
  /** A category id. */
  then: string;
}

export interface Scheme {
  name: string;
  /** Goes up by one with every change; every verdict records the revision that made it. */
  revision: number;
  categories: Category[];
  /** Sentences for the borderline cases, shown to an agent with the definitions. */
  guidance: string[];
  examples: SchemeExample[];
  /** The team's own rules, tried in order before toil's built-in signals. */
  rules: Rule[];
  /** Whether toil's built-in keep-the-lights-on signals apply, below the rules. */
  signals: boolean;
  /** A tracker's own spelling of a category's label: `{ "ado": { "ktlo": "KTLO" } }`. */
  labels: Record<string, Record<string, string>>;
}

/** Where a scheme was found, highest first: the order `--scheme`, your folder, the repository, beside the toil project, built in. */
export type SchemeSource = 'file' | 'user' | 'repo' | 'toil-project' | 'built-in';

/** A scheme as resolved: where it came from, and the file when it has one. */
export interface FoundScheme {
  scheme: Scheme;
  source: SchemeSource;
  /** Absolute, with forward slashes. Absent for a built-in scheme. */
  file?: string;
}

/**
 * Where a toil project says the category goes in one tracker besides labels.
 * `field` is a field alias from the toil project's section (`workCategory`), a
 * field id, or on GitHub the name of a Projects v2 single-select field;
 * `project` is GitHub's project as `<owner>/<number>`; `values` maps a
 * category id to the field's option where it isn't the category's `short`.
 */
export interface ClassifyTarget {
  field?: string;
  project?: string;
  values?: Record<string, string>;
}

/** The toil project's `classify` key. */
export interface ClassifySettings {
  scheme?: string;
  targets: Partial<Record<ClassifyArea, ClassifyTarget>>;
}

/** A target with its field resolved to the id the tracker's own record uses, so a category already there can be read. */
export interface ResolvedTarget extends ClassifyTarget {
  /** Jira's `customfield_10042`, Azure DevOps's `Custom.WorkCategory`. GitHub reads by `field`, the name. */
  fieldId?: string;
}

/**
 * What settled an item: a scheme label already on it (the record), or a field value where no label settles it, one of
 * the team's rules, a built-in signal, its parent's verdict, the person's own
 * AI agent, a person, or nothing.
 */
export type VerdictSource = 'label' | 'field' | 'parent' | 'agent' | 'person' | 'unsure' | `rule:${string}` | `signal:${string}`;

export interface Verdict {
  /** The item's OWI id, `<connection>:<key>`. */
  id: string;
  key: string;
  area: string;
  connection: string;
  title: string;
  url: string | null;
  /** The category's id, or null when the verdict is unsure. */
  category: string | null;
  name: string | null;
  short: string | null;
  source: VerdictSource;
  /** One sentence a person can check: which label, rule or signal, and what it matched. */
  reason: string;
  scheme: string;
  revision: number;
}

/** A verdict an agent sends back through `classify run --verdicts`: `category` is a category id or `unsure`. */
export interface AgentVerdict {
  id: string;
  category: string;
  reason: string;
}

/** The field a plan's entries set, by the name the toil project gave it; `categorize` resolves it against the tracker. */
export interface PlanField {
  name: string;
  /** GitHub only: the Projects v2 project, `<owner>/<number>`. */
  project?: string;
}

/**
 * One item's change, as far as the input showed it: the category's label to
 * add, the scheme's other labels found on it to remove, and the field's
 * value. `categorize` reads the item first and sends only what still differs.
 */
export interface PlanItem {
  id: string;
  key: string;
  category: string;
  labels: { add: string[]; remove: string[] };
  field?: { value: string };
}

/** One tracker connection's share of a plan; one `categorize` call applies one of these. */
export interface PlanGroup {
  area: ClassifyArea;
  connection: string;
  /** Category id to this tracker's label, so a command knows which labels are the scheme's. */
  labels: Record<string, string>;
  field?: PlanField;
  items: PlanItem[];
}

export interface ClassifySummary {
  items: number;
  /** Items per category id, plus `unsure`. */
  byCategory: Record<string, number>;
  /** Items per source, with rules and signals by their own names. */
  bySource: Record<string, number>;
  /** The share (0 to 1) settled by a rule, a signal or a parent; null when there were no items. */
  settledByRules: number | null;
  /** How many items already carried each category's label before this run, by category id. */
  alreadyLabelled: Record<string, number>;
}

/** The part of `classify run`'s data a `categorize` command reads. */
export interface ClassifyPlan {
  scheme: { name: string; revision: number };
  categories: Category[];
  plan: PlanGroup[];
}

/** `classify run`'s data. */
export interface ClassifyResult extends ClassifyPlan {
  /**
   * The scheme, and where `classify run` found it (principle 4). The engine is
   * handed a scheme and never looks for one, so it leaves `source` and `file`
   * out; the command that resolved the scheme adds them.
   */
  scheme: ClassifyPlan['scheme'] & { source?: SchemeSource; file?: string };
  toilProject: string | null;
  verdicts: Verdict[];
  summary: ClassifySummary;
}

/** What one `categorize` call did to one item. */
export interface CategorizeChange {
  id: string;
  key: string;
  category: string;
  labels: { added: string[]; removed: string[] };
  /** The value the field was set to, or null when it was left alone. */
  field: { value: string } | null;
}

/**
 * What every tracker's `categorize` returns, so a caller reads one shape for
 * all three; an area may add fields of its own beside these.
 */
export interface CategorizeResult {
  connection: string;
  scheme: { name: string; revision: number };
  /** The field that was set, with the tracker's own id for it; null when the plan names none. */
  field: (PlanField & { id?: string }) | null;
  changed: CategorizeChange[];
  /** Keys already as the plan wants them: nothing was sent. */
  unchanged: string[];
  failed: Array<{ key: string; reason: string }>;
  /** The plan's entries for other connections, which this call left alone. */
  skipped: Array<{ area: string; connection: string; items: number }>;
  counts: { planned: number; changed: number; unchanged: number; failed: number };
}

/** A category's label in one tracker: the scheme's override for the area, else the category's own. */
export function labelFor(scheme: Pick<Scheme, 'labels'>, area: string, category: Pick<Category, 'id' | 'label'>): string {
  return scheme.labels[area]?.[category.id] ?? category.label;
}

/** A category's value in a tracker's field: the target's mapping, else the category's `short`. */
export function fieldValueFor(target: Pick<ClassifyTarget, 'values'> | undefined, category: Pick<Category, 'id' | 'short'>): string {
  return target?.values?.[category.id] ?? category.short;
}
