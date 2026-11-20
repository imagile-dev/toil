/**
 * Settings, Ticket rules (#657): a team's rules for how a ticket is written,
 * as plain text a person edits freely. The page's focus is which rule sets a
 * Toil project uses (`projects standards set`, or none at all with
 * `--clear`); the library of sets is one press further in, under "Your rule
 * sets". Each set of rules is a standard toil keeps (`toil standards list`);
 * the person's own are edited in place and saved with `standards save`,
 * removed with `standards remove`. All three are a person's commands, which
 * toil serves through the API only for a person and never over MCP, so only
 * the person chooses or writes the rules an agent's work is judged by
 * (principle 2). A built-in starter or a repository's set is read-only, with
 * "Edit a copy", which saves it as the person's own under the same name. A
 * rule is added from a starter prompt (the built-in rules' text) or a blank
 * one, and then is just words.
 * Whether an item meets a rule is the person's AI agent's reading, on its own
 * press on Tickets or an item's page; nothing here asks it. The page never
 * shows where a file is: a path is for the person who owns the disk. Amending
 * the ticket template no longer needs a ticket, which is a first.
 */

import { useEffect, useState } from 'react';
import { Button } from 'react-aria-components';
import type { ConfigApi } from '../../config.ts';
import { BUILTIN_STANDARDS } from '../../../../src/core/standards/builtin.ts';
import { STANDARD_LIMITS } from '../../../../src/core/standards/read.ts';
import { STANDARD_NAME } from '../../../../src/core/standards/types.ts';
import type { StandardRule, StandardSummary } from '../../rules.ts';
import { Help, InfoTip } from '../../components/help.tsx';
import { NavButton } from '../../components/nav-button.tsx';
import { Card } from '../../components/layout.tsx';
import { SummaryChevron } from '../../components/disclosure.tsx';
import { AreaField, CheckField, OutcomeLine, SelectField, TextField, failedOutcome, outcomeOf, type Outcome } from './parts.tsx';
import type { Envelope } from '../../toil.ts';

const SOURCE_WORD: Record<string, string> = { user: 'Yours', repo: "The repository's", 'built-in': 'Built in', file: 'A file', 'toil-project': 'Beside a Toil project' };

/** The starter prompts a rule may begin from: every built-in rule, by a name that says what it is for. */
export const STARTERS: ReadonlyArray<{ key: string; label: string; rule: StandardRule }> = BUILTIN_STANDARDS.flatMap((s) => s.rules.map((r) => ({ key: `${s.name}/${r.id}`, label: s.name === 'bug-repro' ? `Bug: ${r.name.toLowerCase()}` : r.name, rule: r })));

/** A rule id from its name: lowercase words and hyphens, unique within the set. */
export function ruleId(name: string, taken: ReadonlySet<string>): string {
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '') || 'rule').slice(0, 36).replace(/-+$/, '');
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

interface Draft {
  name: string;
  description: string;
  rules: StandardRule[];
  /** A set not saved yet: its name is still being typed. */
  fresh: boolean;
  /** Rule ids this draft made and hasn't saved: each follows its rule's name until the set is saved, so a blank rule's `new-rule` becomes what it is called. */
  unsaved?: string[];
}

/** What's wrong with a draft before toil is asked, in words beside Save; empty when toil would take it (toil checks again on save). */
export function draftProblems(d: Draft): string[] {
  const out: string[] = [];
  if (!STANDARD_NAME.test(d.name)) out.push('The name is lowercase letters, digits and hyphens, starting with a letter, such as team-stories.');
  if (d.rules.length === 0) out.push('Add at least one rule.');
  if (d.description.length > STANDARD_LIMITS.description) out.push(`The description is at most ${STANDARD_LIMITS.description} characters.`);
  d.rules.forEach((r, i) => {
    if (!r.name.trim()) out.push(`Rule ${i + 1} needs a name.`);
    if (!r.text.trim()) out.push(`Rule ${i + 1} needs instructions.`);
    if (r.text.length > STANDARD_LIMITS.ruleText) out.push(`Rule ${i + 1}'s instructions are at most ${STANDARD_LIMITS.ruleText} characters.`);
  });
  return out;
}

/** The standard as `standards save` reads it. */
const bodyOf = (d: Draft) => JSON.stringify({ ...(d.description.trim() ? { description: d.description.trim() } : {}), rules: d.rules.map((r) => ({ id: r.id, name: r.name.trim(), text: r.text })) });

/** An envelope's failure in the words the page shows: toil's message, then its fix. */
const failureOf = (e: Envelope) => (e.ok ? '' : `${e.error.message}${e.error.fix ? ` ${e.error.fix}` : ''}`);
const thrown = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function TicketRules({ config }: { config: ConfigApi }) {
  const [list, setList] = useState<StandardSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    config.run('standards list', {}).then(
      (e) => live && (e.ok ? (setList((e.data as { standards: StandardSummary[] }).standards), setProblem(null)) : setProblem(failureOf(e))),
      (e: unknown) => live && setProblem(thrown(e)),
    );
    return () => {
      live = false;
    };
  }, [config, version]);
  const reload = () => setVersion((v) => v + 1);
  if (problem) return <p className="failure" role="alert">Couldn't read the ticket rules: {problem}</p>;
  if (!list) return <p className="note">Reading the ticket rules…</p>;
  return (
    <>
      <UseRules config={config} standards={list} />
      <Library config={config} list={list} onSaved={reload} />
    </>
  );
}

/** A read that may still be running, may have failed (with toil's words), or came back. */
type Read<T> = { state: 'reading' } | { state: 'failed'; message: string } | { state: 'read'; value: T };

/**
 * The page's focus: which sets a Toil project's items are held to, one checkbox a set, or none at all, saved with
 * `projects standards set --replace` (or `--clear` for none). A failed read says so, in toil's words, and never reads
 * as a Toil project with no rules (principle 12).
 */
function UseRules({ config, standards }: { config: ConfigApi; standards: StandardSummary[] }) {
  const [projects, setProjects] = useState<Read<string[]>>({ state: 'reading' });
  const [chosen, setChosen] = useState<string>('');
  const [use, setUse] = useState<Read<string[]>>({ state: 'reading' });
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    config.run('projects list', {}).then(
      (e) => {
        if (!live) return;
        if (!e.ok) return setProjects({ state: 'failed', message: failureOf(e) });
        const names = ((e.data as { toilProjects?: Array<{ name: string }> }).toilProjects ?? []).map((t) => t.name);
        setProjects({ state: 'read', value: names });
        setChosen((c) => c || names[0] || '');
      },
      (e: unknown) => live && setProjects({ state: 'failed', message: thrown(e) }),
    );
    return () => {
      live = false;
    };
  }, [config]);
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    setUse({ state: 'reading' });
    setOutcome(null);
    config.run('projects show', { toilProject: chosen }).then(
      (e) => live && setUse(e.ok ? { state: 'read', value: (e.data as { toilProject?: { standards?: { use?: string[] } } }).toilProject?.standards?.use ?? [] } : { state: 'failed', message: failureOf(e) }),
      (e: unknown) => live && setUse({ state: 'failed', message: thrown(e) }),
    );
    return () => {
      live = false;
    };
  }, [config, chosen]);
  const heading = (
    <h2 id="rules-use">
      Rules a Toil project uses <Help topic="ticket-rules" note="Only you choose these, here or in your own terminal: an AI agent can't." />
    </h2>
  );
  if (projects.state === 'reading') return null;
  if (projects.state === 'failed') {
    return (
      <Card as="section" className="panel change-form rules-use" aria-labelledby="rules-use" data-rules-use="">
        {heading}
        <p className="failure" role="alert" data-rules-use-failed="">
          Couldn't read your Toil projects: {projects.message}
        </p>
      </Card>
    );
  }
  if (!projects.value.length) {
    return (
      <Card as="section" className="panel change-form rules-use" aria-labelledby="rules-use" data-rules-use="">
        {heading}
        <p className="note">No Toil project yet, so there is nothing to hold to these rules.</p>
        <p>
          <NavButton href="#/settings/projects/+new" data-rules-new-project="">
            Create a Toil project
          </NavButton>
        </p>
      </Card>
    );
  }
  const picked = use.state === 'read' ? use.value : [];
  const none = use.state === 'read' && picked.length === 0;
  const save = async () => {
    if (use.state !== 'read') return;
    setBusy(true);
    try {
      const input = picked.length ? { toilProject: chosen, use: picked, replace: true } : { toilProject: chosen, clear: true };
      setOutcome(outcomeOf(await config.run('projects standards set', input), picked.length ? `${chosen}'s items are held to ${picked.join(', ')}.` : `${chosen} uses no rule sets now.`));
    } catch (e) {
      setOutcome(failedOutcome(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = (n: string, on: boolean) => setUse((u) => (u.state === 'read' ? { state: 'read', value: on ? [...u.value, n] : u.value.filter((x) => x !== n) } : u));
  // A path a Toil project names beside its file isn't in the list by name; it stays chosen, and is shown as it is named.
  const names = [...new Set([...standards.map((s) => s.name), ...picked])];
  return (
    <Card as="section" className="panel change-form rules-use" aria-labelledby="rules-use" data-rules-use="">
      {heading}
      <SelectField label="Toil project" value={chosen} onChange={setChosen} options={projects.value.map((p) => ({ value: p, label: p }))} />
      {use.state === 'reading' ? (
        <p className="note">Reading {chosen}…</p>
      ) : use.state === 'failed' ? (
        <p className="failure" role="alert" data-rules-use-failed="">
          Couldn't read {chosen}: {use.message}
        </p>
      ) : (
        <>
          <fieldset className="rules-use__sets">
            <legend>Hold its items to</legend>
            {names.map((n) => (
              <CheckField key={n} label={n} checked={picked.includes(n)} onChange={(on) => toggle(n, on)} />
            ))}
            <CheckField label="No rule sets" checked={none} onChange={(on) => on && setUse({ state: 'read', value: [] })} hint={none ? 'Its items are held to the five checks alone.' : undefined} />
          </fieldset>
          <p>
            <Button className="btn" onPress={() => void save()} isDisabled={busy || Boolean(config.disabled)} data-rules-use-save="">
              {none ? 'Use no rule sets' : 'Use these rules'}
            </Button>
          </p>
        </>
      )}
      <OutcomeLine outcome={outcome} />
    </Card>
  );
}

/** The library of sets, one press in: "Your rule sets", with New set of rules at its top, then each set. */
function Library({ config, list, onSaved }: { config: ConfigApi; list: StandardSummary[]; onSaved: () => void }) {
  const [drafting, setDrafting] = useState<Draft | null>(null);
  return (
    <Card as="section" className="panel rules-library" aria-labelledby="rules-library" data-rules-library="">
      <details>
        <summary className="rules-library__summary">
          <SummaryChevron />
          <h2 id="rules-library">Your rule sets</h2>
          <span className="note">{list.length}</span>
        </summary>
        <div className="rules-library__body">
          {drafting ? (
            <Editor config={config} draft={drafting} onCancel={() => setDrafting(null)} onSaved={() => (setDrafting(null), onSaved())} />
          ) : (
            <p>
              <Button className="btn" isDisabled={Boolean(config.disabled)} onPress={() => setDrafting({ name: '', description: '', rules: [], fresh: true, unsaved: [] })} data-rules-new="">
                New set of rules
              </Button>
            </p>
          )}
          {list.map((s) => (
            <StandardCard key={`${s.name}:${s.source}:${s.revision}`} config={config} standard={s} onSaved={onSaved} />
          ))}
        </div>
      </details>
    </Card>
  );
}

/** One set of rules: read-only with "Edit a copy" unless it is the person's own, which opens in the editor on "Edit". */
function StandardCard({ config, standard, onSaved }: { config: ConfigApi; standard: StandardSummary; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = standard.source === 'user';
  if (editing) return <Editor config={config} draft={{ name: standard.name, description: standard.description ?? '', rules: standard.rules.map((r) => ({ ...r })), fresh: false }} copyOf={mine ? null : standard.source} onCancel={() => setEditing(false)} onSaved={onSaved} />;
  const remove = async () => {
    setBusy(true);
    try {
      const e = await config.run('standards remove', { name: standard.name });
      setOutcome(outcomeOf(e, `Removed your ${standard.name}.`));
      if (e.ok) onSaved();
    } catch (e) {
      setOutcome(failedOutcome(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rules-set" aria-labelledby={`rules-set-${standard.name}`} data-rules-set={standard.name}>
      <div className="rules-set__head">
        <h3 id={`rules-set-${standard.name}`}>{standard.name}</h3>
        {/* Whose it is, in a word; its revision is the word's tooltip (#657). */}
        <span className="rule-badge" title={`Revision ${standard.revision}`} data-rules-source={standard.source}>
          {SOURCE_WORD[standard.source] ?? standard.source}
        </span>
        <span className="control-row__group">
          <Button className="btn btn--secondary btn--sm" isDisabled={Boolean(config.disabled)} onPress={() => setEditing(true)} data-rules-edit={standard.name}>
            {mine ? 'Edit' : 'Edit a copy'}
          </Button>
          {mine && (
            <Button className="btn btn--secondary btn--sm" isDisabled={busy || Boolean(config.disabled)} onPress={() => void remove()} data-rules-remove={standard.name}>
              Remove
            </Button>
          )}
        </span>
      </div>
      {standard.description && <p>{standard.description}</p>}
      <ul className="plain rules-set__rules">
        {standard.rules.map((r) => (
          <li key={r.id}>
            <details>
              <summary>
                <SummaryChevron />
                {r.name}
              </summary>
              <p className="rules-set__text">{r.text}</p>
            </details>
          </li>
        ))}
      </ul>
      <OutcomeLine outcome={outcome} />
    </section>
  );
}

/** Editing a set: its name (new ones only), description, and each rule's name and instructions, with rules added from a starter or blank. */
function Editor({ config, draft: start, copyOf = null, onCancel, onSaved }: { config: ConfigApi; draft: Draft; copyOf?: string | null; onCancel: () => void; onSaved: () => void }) {
  const [d, setD] = useState<Draft>({ ...start, unsaved: start.unsaved ?? [] });
  const [starter, setStarter] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const problems = draftProblems(d);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setRule = (i: number, patch: Partial<StandardRule>) =>
    setD((x) => {
      const rules = x.rules.map((r, n) => (n === i ? { ...r, ...patch } : r));
      const old = x.rules[i]!;
      // A rule this draft made follows its name until the set is saved; a saved rule keeps its id, so its readings stay its own.
      if (patch.name !== undefined && x.unsaved?.includes(old.id)) {
        const id = ruleId(patch.name || 'rule', new Set(rules.filter((_, n) => n !== i).map((r) => r.id)));
        rules[i] = { ...rules[i]!, id };
        return { ...x, rules, unsaved: x.unsaved.map((u) => (u === old.id ? id : u)) };
      }
      return { ...x, rules };
    });
  const add = () => {
    const from = STARTERS.find((s) => s.key === starter)?.rule;
    const taken = new Set(d.rules.map((r) => r.id));
    const name = from?.name ?? 'New rule';
    const id = ruleId(from?.id ?? name, taken);
    set({ rules: [...d.rules, { id, name, text: from?.text ?? '' }], unsaved: [...(d.unsaved ?? []), id] });
  };
  const save = async () => {
    setBusy(true);
    try {
      const e = await config.run('standards save', { name: d.name, text: bodyOf(d) });
      setOutcome(outcomeOf(e, e.ok ? `Saved ${d.name} as revision ${(e.data as { revision?: number }).revision ?? '?'}, your own.` : ''));
      if (e.ok) onSaved();
    } catch (e) {
      setOutcome(failedOutcome(e));
    } finally {
      setBusy(false);
    }
  };
  const id = `rules-edit-${d.fresh ? 'new' : d.name}`;
  const copyNote = copyOf ? `This is ${SOURCE_WORD[copyOf]?.toLowerCase() ?? copyOf} set. Saving keeps your own copy under the same name, which is what ${d.name} then means on this computer; removing your copy brings the original back.` : null;
  return (
    <section className="change-form rules-edit" aria-labelledby={id} data-rules-editor={d.fresh ? '' : d.name}>
      <h3 id={id} className="control-row__group">
        {d.fresh ? 'New set of rules' : `Editing ${d.name}`}
        {copyNote && (
          <InfoTip label="Editing a copy" tip={copyNote} triggerProps={{ 'data-rules-copy-help': '' }}>
            <p>{copyNote}</p>
          </InfoTip>
        )}
      </h3>
      {d.fresh && <TextField label="Name" value={d.name} onChange={(v) => set({ name: v.trim() })} required placeholder="team-stories" hint="Lowercase letters, digits and hyphens. A Toil project names the set by it." />}
      <TextField label="Description" value={d.description} onChange={(v) => set({ description: v })} hint="One line saying what the set is for. Optional." />
      {d.rules.length > 0 && <p className="note rules-edit__hint">Write each rule's instructions in plain words, as many lines as you need, and say which items it is for: your AI agent decides from these words whether it applies.</p>}
      {d.rules.map((r, i) => (
        <fieldset key={i} className="rules-edit__rule" data-rule-edit={r.id}>
          <legend>Rule {i + 1}</legend>
          <TextField label="Name" value={r.name} onChange={(v) => setRule(i, { name: v })} required />
          <AreaField label="Instructions" rows={5} value={r.text} onChange={(v) => setRule(i, { text: v })} />
          <p className="rules-edit__control">
            <Button className="btn btn--secondary btn--sm" onPress={() => set({ rules: d.rules.filter((_, n) => n !== i) })} data-rule-remove={r.id}>
              Remove this rule
            </Button>
          </p>
        </fieldset>
      ))}
      <div className="rules-edit__add">
        <SelectField label="Start a rule from" value={starter} onChange={setStarter} options={[{ value: '', label: 'A blank rule' }, ...STARTERS.map((s) => ({ value: s.key, label: s.label }))]} />
        <p className="rules-edit__control">
          <Button className="btn btn--sm" onPress={add} isDisabled={d.rules.length >= STANDARD_LIMITS.rules} data-rule-add="">
            Add a rule
          </Button>
        </p>
      </div>
      {problems.length > 0 && (
        <ul className="plain note rules-edit__problems">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <p className="control-row__group">
        <Button className="btn btn--accent" onPress={() => void save()} isDisabled={busy || problems.length > 0 || Boolean(config.disabled)} data-rules-save="">
          Save
        </Button>
        <Button className="btn btn--secondary" onPress={onCancel}>
          Cancel
        </Button>
      </p>
      <OutcomeLine outcome={outcome} />
    </section>
  );
}
