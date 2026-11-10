/**
 * The Classification editor (#566), a section of a Toil project's own edit
 * page, never an app-wide setting: which categories this Toil project sorts its
 * work by, the field each tracker keeps the category in, and the categories
 * themselves: names, short forms, definitions, labels, guidance, rules and the
 * built-in signals. It opens on one line ("Keep the lights on / Feature, 2
 * rules, signals on, revision 3"), and each part is a step in (principle 11).
 *
 * Choosing another scheme and naming a field are toil's own commands for the
 * Toil project (`projects classify set`), run on a press like any change on
 * these pages. Saving the categories is `classify scheme set`, a person's
 * command, run by Toil UI's server on a press and never by an agent. The
 * scheme's JSON is assembled here and checked by toil's own reader before Save
 * can be pressed, with each problem named where it is, so a draft the page
 * accepts is a draft toil accepts. Each rule shows how many of the items already
 * read it would catch, counted by the same engine `classify run` uses. A
 * built-in scheme is saved as the person's own copy, and the page says so first.
 * The page never shows where a scheme's file is: a path is for the person who owns the disk. A rulebook anyone can amend in
 * a form is the nearest most teams come to a constitution, and this one at least counts its amendments.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button } from 'react-aria-components';
import type { Scheme } from '../../../../src/core/classify/types.ts';
import type { ClassifyApi, LedgerView, SaveResult } from '../../classify-api.ts';
import type { ConfigApi } from '../../config.ts';
import { Help } from '../../components/help.tsx';
import '../../components/classify.css';
import { blankCategory, blankRule, checkDraft, draftOf, ruleCounts, sameDraft, schemeSummaryLine, whenText, type DraftCategory, type DraftRule, type SchemeDraft } from '../../model/scheme-edit.ts';
import type { WorkItem } from '../../toil.ts';
import { OutcomeLine, failedOutcome, outcomeOf, type Outcome } from './parts.tsx';

interface SchemeRow {
  name: string;
  revision: number;
  source: string;
  categories: Array<{ id: string; short: string; name: string }>;
}

interface Shown {
  classify: { scheme?: string; targets?: Record<string, { field?: string; project?: string }> } | null;
  areas: string[];
}

const KEPT = { 'built-in': 'built in to toil', yours: 'your own copy', shared: 'shared in the repository' } as const;
const AREA_NAME: Record<string, string> = { jira: 'Jira', github: 'GitHub', ado: 'Azure DevOps' };
const CLASSIFY_AREAS = ['jira', 'github', 'ado'];

const said = (r: SaveResult) => `Saved as revision ${r.revision}, ${r.kept === 'yours' ? 'kept as your own copy' : r.kept === 'shared' ? 'in the repository, ready for a pull request' : 'as a built-in scheme'}.`;

function Field({ label, value, onChange, hint, wide = false }: { label: string; value: string; onChange: (v: string) => void; hint?: string; wide?: boolean }) {
  return (
    <label>
      {label}
      {wide ? <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} /> : <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />}
      {hint && <span className="note">{hint}</span>}
    </label>
  );
}

export function ClassificationEditor({ config, classify, toilProject, loadItems }: { config: ConfigApi; classify: ClassifyApi | undefined; toilProject: string; loadItems?: ((toilProject: string) => Promise<WorkItem[]>) | undefined }) {
  const [view, setView] = useState<LedgerView | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [schemes, setSchemes] = useState<SchemeRow[]>([]);
  const [items, setItems] = useState<WorkItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [draft, setDraft] = useState<SchemeDraft | null>(null);
  const [base, setBase] = useState<SchemeDraft | null>(null);
  const [chosen, setChosen] = useState<string>('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Outcome | null>(null);
  const [targeted, setTargeted] = useState<Outcome | null>(null);
  const [savedAs, setSavedAs] = useState<Outcome | null>(null);
  const [saving, setSaving] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (!classify) throw new Error('This page has no categories to read.');
        const v = await classify.ledger(toilProject);
        const e = await config.run('projects show', { toilProject });
        const l = await config.run('classify scheme list', {});
        if (!live) return;
        const data = e.ok ? (e.data as { toilProject?: { classify?: Shown['classify'] }; areas?: Record<string, unknown> }) : null;
        const own = data?.toilProject?.classify ?? null;
        setView(v);
        setShown({ classify: own, areas: Object.keys(data?.areas ?? {}).filter((a) => CLASSIFY_AREAS.includes(a)) });
        setSchemes(l.ok ? (l.data as { schemes: SchemeRow[] }).schemes : []);
        const first = draftOf(v.scheme);
        setBase(first);
        setDraft(first);
        setChosen(own?.scheme ?? v.scheme.name);
        setFields(Object.fromEntries(CLASSIFY_AREAS.map((a) => [a, own?.targets?.[a]?.field ?? ''])));
      } catch (e) {
        if (live) setProblem(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [classify, config, toilProject, round]);

  useEffect(() => {
    let live = true;
    loadItems?.(toilProject).then((i) => live && setItems(i), () => live && setItems(null));
    return () => {
      live = false;
    };
  }, [loadItems, toilProject]);

  const checked = useMemo(() => (draft ? checkDraft(draft) : null), [draft]);
  // The counts follow the draft while it is valid, and the saved scheme while it is not, so a half-typed rule never blanks them.
  const counted: Scheme | null = checked?.scheme ?? view?.scheme ?? null;
  const counts = useMemo(() => (counted && items ? ruleCounts(counted, items) : null), [counted, items]);

  if (problem) {
    return (
      <section aria-labelledby="toil-project-form-classification" className="change-form cedit">
        <h3 id="toil-project-form-classification" className="sr-only">Classification</h3>
        <p className="failure" role="alert">{problem}</p>
      </section>
    );
  }
  if (!view || !draft || !base || !shown) return <p className="note">Reading the categories…</p>;

  const set = (change: Partial<SchemeDraft>) => setDraft({ ...draft, ...change });
  const setCategory = (i: number, c: Partial<DraftCategory>) => set({ categories: draft.categories.map((x, n) => (n === i ? { ...x, ...c } : x)) });
  const setRule = (i: number, r: Partial<DraftRule>) => set({ rules: draft.rules.map((x, n) => (n === i ? { ...x, ...r } : x)) });
  const changed = !sameDraft(draft, base);
  const valid = checked !== null && checked.scheme !== null;
  const disabled = config.disabled ?? classify?.disabled ?? null;

  const choose = async () => {
    setPicked(null);
    try {
      setPicked(outcomeOf(await config.run('projects classify set', { toilProject, scheme: chosen, ...(shown.classify?.scheme ? { replace: true } : {}) }), `${toilProject} now sorts its work by ${schemes.find((s) => s.name === chosen)?.categories.map((c) => c.name).join(' / ') ?? chosen}.`));
      setRound((n) => n + 1);
    } catch (e) {
      setPicked(failedOutcome(e));
    }
  };
  const saveTargets = async () => {
    setTargeted(null);
    const target = shown.areas.flatMap((a) => (fields[a]?.trim() ? [`${a}.field=${fields[a]!.trim()}`] : []));
    if (target.length === 0) return setTargeted({ ok: false, message: 'Type the field a tracker keeps the category in first.', fix: null });
    try {
      setTargeted(outcomeOf(await config.run('projects classify set', { toilProject, target, replace: true }), 'The fields are saved.'));
      setRound((n) => n + 1);
    } catch (e) {
      setTargeted(failedOutcome(e));
    }
  };
  const save = async () => {
    if (!checked?.scheme || !classify) return;
    setSaving(true);
    setSavedAs(null);
    try {
      const result = await classify.saveScheme(toilProject, checked.scheme);
      setSavedAs({ ok: true, message: said(result), warnings: result.warnings });
      setRound((n) => n + 1);
    } catch (e) {
      setSavedAs(failedOutcome(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="toil-project-form-classification" className="change-form cedit" data-classification-editor="">
      <h3 id="toil-project-form-classification" className="sr-only">Classification of {toilProject}</h3>
      <p className="cedit__summary" data-classification-summary="">
        {schemeSummaryLine(view.scheme)}. <span className="note">{KEPT[view.kept].charAt(0).toUpperCase()}{KEPT[view.kept].slice(1)}.</span> <Help topic="classification-editor" />
      </p>

      <details>
        <summary>Which categories this Toil project uses</summary>
        <div className="cedit__part">
          <label>
            Categories
            <select value={chosen} onChange={(e) => setChosen(e.target.value)} data-scheme-pick="">
              {schemes.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.categories.map((c) => c.name).join(' / ')} ({s.source === 'built-in' ? 'built in' : s.source === 'user' ? 'your own' : 'shared'}, revision {s.revision})
                </option>
              ))}
            </select>
          </label>
          <div>
            <Button className="btn" onPress={() => void choose()} isDisabled={Boolean(disabled) || chosen === (shown.classify?.scheme ?? view.scheme.name)} data-scheme-use="">
              Use these categories
            </Button>
          </div>
          <OutcomeLine outcome={picked} />
        </div>
      </details>

      {shown.areas.length > 0 && (
        <details>
          <summary>Where each tool keeps the category</summary>
          <div className="cedit__part">
            <p className="note">The category always goes on the item as a label. If a tracker also has a field for it, name the field and toil sets that too. Toil never creates a field, so an admin makes it first.</p>
            {shown.areas.map((a) => (
              <Field key={a} label={`${AREA_NAME[a] ?? a}: field`} value={fields[a] ?? ''} onChange={(v) => setFields({ ...fields, [a]: v })} hint={a === 'github' ? "The name of a single-select field on the GitHub project." : "A field's name in this Toil project's field names, or its id."} />
            ))}
            <div>
              <Button className="btn" onPress={() => void saveTargets()} isDisabled={Boolean(disabled)} data-targets-save="">
                Save the fields
              </Button>
            </div>
            <OutcomeLine outcome={targeted} />
          </div>
        </details>
      )}

      <details>
        <summary>The categories ({draft.categories.length})</summary>
        <div className="cedit__part">
          {draft.categories.map((c, i) => (
            <div key={i} className="cedit__card" data-category-card={i}>
              <Field label="Name" value={c.name} onChange={(v) => setCategory(i, { name: v })} />
              <Field label="Short form" value={c.short} onChange={(v) => setCategory(i, { short: v })} hint="The term of art, shown on hover." />
              <Field label="What it means" value={c.definition} onChange={(v) => setCategory(i, { definition: v })} wide />
              <Field label="Label in the tracker" value={c.label} onChange={(v) => setCategory(i, { label: v })} hint="One word, no spaces." />
              {!base.categories.some((b) => b.id === c.id) && <Field label="Id" value={c.id} onChange={(v) => setCategory(i, { id: v })} hint="Lowercase letters, digits and hyphens. It can't change once saved." />}
              {draft.categories.length > 2 && (
                <div>
                  <Button className="btn btn--small btn--quiet" onPress={() => set({ categories: draft.categories.filter((_, n) => n !== i), rules: draft.rules.filter((r) => r.then !== c.id) })}>
                    Remove this category
                  </Button>
                </div>
              )}
            </div>
          ))}
          <div>
            <Button className="btn btn--small" onPress={() => set({ categories: [...draft.categories, blankCategory()] })}>
              Add a category
            </Button>
          </div>
        </div>
      </details>

      <details>
        <summary>
          Rules ({draft.rules.length})
        </summary>
        <div className="cedit__part">
          <p className="note">A rule settles an item before anything else but a label already on it. The first rule that fits wins.</p>
          {draft.rules.map((r, i) => {
            const count = counts?.[r.id.trim()];
            return (
              <div key={i} className="cedit__card" data-rule-card={i}>
                <Field label="Rule name" value={r.id} onChange={(v) => setRule(i, { id: v })} hint="Lowercase letters, digits and hyphens." />
                <Field label="It sits under (items or keys, separated by commas)" value={r.parent} onChange={(v) => setRule(i, { parent: v })} />
                <Field label="It carries the label" value={r.label} onChange={(v) => setRule(i, { label: v })} />
                <Field label="Its type is" value={r.type} onChange={(v) => setRule(i, { type: v })} />
                <Field label="Its title contains" value={r.title} onChange={(v) => setRule(i, { title: v })} />
                <label>
                  Then it is
                  <select value={r.then} onChange={(e) => setRule(i, { then: e.target.value })}>
                    {draft.categories.map((c) => (
                      <option key={c.id || i} value={c.id}>
                        {c.name || c.id}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="cedit__count" data-rule-count={r.id}>
                  {count === undefined || count === null ? <span className="note">How many items it catches: not read yet.</span> : <>Matches <strong>{count}</strong> {count === 1 ? 'item' : 'items'} read from this Toil project.</>}
                </p>
                <div>
                  <Button className="btn btn--small btn--quiet" onPress={() => set({ rules: draft.rules.filter((_, n) => n !== i) })}>
                    Remove this rule
                  </Button>
                </div>
              </div>
            );
          })}
          <div>
            <Button className="btn btn--small" onPress={() => set({ rules: [...draft.rules, blankRule(draft.categories[0]?.id ?? '')] })} data-add-rule="">
              Add a rule
            </Button>
          </div>
        </div>
      </details>

      <details>
        <summary>Guidance for the AI agent, and the built-in signals</summary>
        <div className="cedit__part">
          <label>
            Guidance, one sentence a line
            <textarea rows={4} value={draft.guidance} onChange={(e) => set({ guidance: e.target.value })} />
            <span className="note">What to do with borderline cases. Your AI agent reads it with the definitions.</span>
          </label>
          <label className="check-line">
            <input type="checkbox" checked={draft.signals} onChange={(e) => set({ signals: e.target.checked })} data-signals="" /> Use toil's built-in signals (bug and incident types, security ids, dependency bots) below the rules
          </label>
          {draft.rules.length > 0 && <p className="note">Rules in words: {draft.rules.map((r) => `${r.id || 'a rule'}: when ${whenText(Object.fromEntries([['parent', r.parent], ['label', r.label], ['type', r.type], ['title', r.title]].flatMap(([k, v]) => (v!.trim() ? [[k, v!.split(',').map((s) => s.trim()).filter(Boolean)]] : []))))}`).join('; ')}.</p>}
        </div>
      </details>

      {checked && checked.problems.length > 0 && (
        <div className="failure" role="alert" data-problems="">
          <ul className="cedit__problems">
            {checked.problems.map((p) => (
              <li key={`${p.field}${p.text}`}>
                <strong>{p.field}:</strong> {p.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {view.kept === 'built-in' && changed && <p className="note">These categories are built in, so saving makes your own copy; the built-in ones stay as they are.</p>}
      {disabled && changed && <p className="note" data-sample-cannot-write="">{disabled}</p>}
      {changed && (
        <div className="apply__actions">
          <Button className="btn btn--accent" onPress={() => void save()} isDisabled={!valid || saving || Boolean(disabled)} data-scheme-save="">
            {saving ? 'Saving…' : `Save as revision ${view.scheme.revision + 1}`}
          </Button>
          <Button className="btn btn--quiet" onPress={() => setDraft(base)}>
            Undo my edits
          </Button>
        </div>
      )}
      <OutcomeLine outcome={savedAs} />
    </section>
  );
}
