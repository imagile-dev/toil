/**
 * The places an area's section sends a read to. A dossier section's context
 * inputs (`project`, `repo`, `workspace`, ...) are each one value for every
 * repo or an object of repo name to value; Toil UI resolves with no repo
 * folder, so a per-repo value is never picked for it, and each read has to
 * name its target outright. This turns a section into those targets: one per
 * repo name the per-repo values mention, each carrying every input the section
 * sets, de-duplicated (two repos in one project are one project to read work
 * items from).
 *
 * A section with only plain values has one target that names nothing, so its
 * reads go out as they always did, resolved by toil. Remotes are not consulted
 * here: only GitHub's pair with a host Toil UI can recognise (github-repos.ts),
 * and the other hosts' remote forms are core's to parse. The filing cabinet of
 * remote formats was last audited in a previous reorganisation.
 */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface Target {
  /** The inputs to pass with every read, empty for the one target of a section with only plain values. */
  inputs: Record<string, string>;
  /** What to call it where a screen says it was or wasn't read: the input values, joined. Empty when there is nothing to name. */
  label: string;
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);

/** The section's value of `key` for one repo name: the plain value, or that name's entry in the map. */
const forName = (value: unknown, name: string): string | undefined => (isRec(value) ? text(value[name]) : text(value));

/** Every key of `keys` the section sets, as a plain value or a map. */
const present = (section: Rec, keys: readonly string[]) => keys.filter((k) => text(section[k]) !== undefined || (isRec(section[k]) && Object.keys(section[k] as Rec).length > 0));

/**
 * The targets of `keys` in `section`. A repo name missing a value for one of
 * the keys the section sets is skipped: a read can't be sent half-named.
 */
export function targetsOf(section: Rec, keys: readonly string[]): Target[] {
  const set = present(section, keys);
  const maps = set.filter((k) => isRec(section[k]));
  if (!maps.length) return [{ inputs: {}, label: '' }];
  const names = [...new Set(maps.flatMap((k) => Object.keys(section[k] as Rec)))];
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const inputs: Record<string, string> = {};
    for (const k of set) {
      const v = forName(section[k], name);
      if (v !== undefined) inputs[k] = v;
    }
    if (Object.keys(inputs).length !== set.length) continue;
    const id = JSON.stringify(inputs);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ inputs, label: Object.values(inputs).join('/') });
  }
  return out;
}

/** Every distinct value of a section's `key`, plain or per repo, in the order written. */
export function valuesOf(section: Rec, key: string): string[] {
  const v = section[key];
  return [...new Set(isRec(v) ? Object.values(v).flatMap((x) => text(x) ?? []) : text(v) === undefined ? [] : [text(v)!])];
}
