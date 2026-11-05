/**
 * Find the fields (#561): Jira keeps story points and sprints in custom fields
 * whose ids nobody remembers, and a Toil project can only name what it is told.
 * This reads a few issues with `toil jira field discover` (one of each type, or
 * the issues you name), shows the custom fields that hold a value, and names the
 * ticked ones in the Toil project with `toil projects field`, one call per name,
 * each shown first and each with its own result. The read changes nothing in
 * Jira; naming a field only writes the Toil project's file. Only the fields toil
 * is sure of start ticked. The same component is the wizard's optional step and
 * the box in Settings, Toil projects. A treasure map where X marks the custom field.
 */

import { useEffect, useMemo, useState } from 'react';
import { RadioGroup, Radio } from 'react-aria-components';
import type { ConfigApi, ConnectionRow } from '../../config.ts';
import { fieldCommands, type FieldCommand, type FieldPick, type OwiGuess } from '../../../../src/core/field-discovery.ts';
import { DataTable, Path } from '../../components/layout.tsx';
import { Loader } from '../../moments/Moments.tsx';
import { Info, OutcomeLine, SelectField, TextField, commandLine, failedOutcome, outcomeOf, type Outcome } from './parts.tsx';
import './find-fields.css';

/** `jira field discover`'s data, as this page reads it. */
export interface Discovered {
  deployment: string;
  mode: 'sample' | 'issues';
  project: string | null;
  issueTypes: Array<{ name: string; sampled: string[] | null; status: 'sampled' | 'no-sample'; fields: string[] | null }>;
  fields: Array<{ id: string; name: string; schema: { type: string; custom?: string } | null; example: string; issueTypes: string[]; alias: string; owi: OwiGuess | null; note?: string }>;
  commands: string[];
}

const OWI_WORD: Record<OwiGuess['field'], string> = { estimate: 'Story points', iteration: 'Sprint', team: 'Team', dueDate: 'Due date', priority: 'Priority', type: 'Type' };
const ALIAS = /^[a-z][A-Za-z0-9]*$/;

type Reading = { kind: 'idle' } | { kind: 'reading' } | { kind: 'read'; data: Discovered; warnings: string[] } | { kind: 'failed'; outcome: Outcome };
type Result = { line: string; ok: boolean; message: string; fix: string | null };

export interface FindFieldsProps {
  config: ConfigApi;
  /** The Toil projects the names can go in. */
  toilProjects: string[];
  /** The one to use, when the page already knows (the wizard's, the one being edited). */
  toilProject: string | null;
  /** The Jira connections there are. */
  connections: Array<Pick<ConnectionRow, 'name' | 'area'>>;
  /** The connection to read through, when the page already knows. */
  connection?: string | null;
  titleId?: string;
}

export function FindFields({ config, toilProjects, toilProject, connections, connection = null, titleId }: FindFieldsProps) {
  const jira = connections.filter((c) => c.area === 'jira').map((c) => c.name);
  const [project, setProject] = useState(toilProject ?? toilProjects[0] ?? '');
  const [conn, setConn] = useState(connection ?? jira[0] ?? '');
  useEffect(() => {
    if (toilProject) setProject(toilProject);
  }, [toilProject]);
  useEffect(() => {
    if (connection) setConn(connection);
  }, [connection]);
  const [how, setHow] = useState<'auto' | 'keys'>('auto');
  const [jiraProject, setJiraProject] = useState('');
  const [keys, setKeys] = useState('');
  const [reading, setReading] = useState<Reading>({ kind: 'idle' });
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Result[] | null>(null);
  const [saved, setSaved] = useState<{ file: string | null } | null>(null);
  const [saving, setSaving] = useState(false);

  // The Jira project the Toil project already names is the one to sample, until the person types another.
  useEffect(() => {
    if (!project) return;
    let live = true;
    config.run('projects show', { toilProject: project }).then(
      (e) => {
        const key = e.ok ? (e.data as { areas?: Record<string, { inputs?: Record<string, string> }> }).areas?.jira?.inputs?.project : undefined;
        if (live && key) setJiraProject((now) => now || key);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [config, project]);

  const issueKeys = keys.split(/[\s,]+/).filter(Boolean);
  const ready = how === 'auto' ? jiraProject.trim() !== '' : issueKeys.length > 0;
  const readLine = commandLine('jira field discover', [...(how === 'auto' ? ['--project', jiraProject.trim() || '<project>', '--per-type', '1'] : issueKeys.flatMap((k) => ['--issue', k])), ...(conn ? ['--connection', conn] : [])]);

  const read = async () => {
    setReading({ kind: 'reading' });
    setResults(null);
    setSaved(null);
    try {
      const e = await config.run('jira field discover', { ...(conn ? { connection: conn } : {}), ...(how === 'auto' ? { project: jiraProject.trim(), perType: 1 } : { issue: issueKeys }) });
      if (!e.ok) return setReading({ kind: 'failed', outcome: outcomeOf(e, '') });
      const data = e.data as Discovered;
      // Only what toil is sure of starts ticked; the rest is the person's call.
      setTicked(Object.fromEntries(data.fields.map((f) => [f.id, f.owi?.confidence === 'high'])));
      setAliases(Object.fromEntries(data.fields.map((f) => [f.id, f.alias])));
      setReading({ kind: 'read', data, warnings: (e.meta.warnings ?? []).map((w) => w.message) });
    } catch (err) {
      setReading({ kind: 'failed', outcome: failedOutcome(err) });
    }
  };

  const data = reading.kind === 'read' ? reading.data : null;
  const picks: FieldPick[] = useMemo(() => (data ? data.fields.filter((f) => ticked[f.id]).map((f) => ({ id: f.id, alias: aliases[f.id] ?? f.alias, ...(f.owi ? { owi: f.owi.field } : {}) })) : []), [data, ticked, aliases]);
  const badAlias = picks.find((p) => !ALIAS.test(p.alias));
  const commands: FieldCommand[] = project ? fieldCommands(project, 'jira', picks) : [];

  const run = async (list: FieldCommand[], earlier: Result[]) => {
    setSaving(true);
    const out: Result[] = [...earlier];
    let file: string | null = saved?.file ?? null;
    for (const c of list) {
      let r: Result;
      try {
        const e = await config.run('projects field', c.input);
        r = e.ok ? { line: c.line, ok: true, message: 'Saved.', fix: null } : { line: c.line, ok: false, message: e.error.message, fix: e.error.fix ?? null };
        if (e.ok && typeof (e.data as { file?: unknown } | null)?.file === 'string') file = (e.data as { file: string }).file;
      } catch (err) {
        r = { line: c.line, ok: false, message: err instanceof Error ? err.message : String(err), fix: null };
      }
      out.push(r);
      setResults([...out]);
    }
    setSaved({ file });
    setSaving(false);
  };
  const failed = results?.filter((r) => !r.ok) ?? [];
  const retry = () => void run(commands.filter((c) => failed.some((f) => f.line === c.line)), (results ?? []).filter((r) => r.ok));

  return (
    <section className="find-fields" aria-label="Find the fields">
      {titleId && (
        <h3 id={titleId} tabIndex={-1}>
          Find the fields
        </h3>
      )}
      <p className="explain">
        Jira keeps story points and sprints in custom fields with ids like <code>customfield_10016</code>. toil reads a few issues and shows the custom fields that hold a value, so you can name them without looking the ids up. This only reads Jira, and changes nothing in it.
      </p>
      {jira.length === 0 ? (
        <p className="note">There is no Jira connection yet. Link Jira first, then come back.</p>
      ) : toilProjects.length === 0 ? (
        <p className="note">There is no Toil project to name fields in yet. Create one first.</p>
      ) : (
        <>
          {!toilProject && toilProjects.length > 1 && <SelectField label="Name the fields in" value={project} onChange={setProject} options={toilProjects.map((n) => ({ value: n, label: n }))} />}
          {!connection && jira.length > 1 && <SelectField label="Read from" value={conn} onChange={setConn} options={jira.map((n) => ({ value: n, label: n }))} />}
          <RadioGroup className="agent-adapters" value={how} aria-label="Which issues to read" onChange={(v) => setHow(v === 'keys' ? 'keys' : 'auto')}>
            <Radio value="auto" className="agent-choice">
              <strong>Sample one of each type automatically</strong>
              <span className="note">The most recently updated issue of each type in a Jira project.</span>
            </Radio>
            <Radio value="keys" className="agent-choice">
              <strong>Use issues I pick</strong>
              <span className="note">Paste issue keys, such as PAY-123.</span>
            </Radio>
          </RadioGroup>
          {how === 'auto' ? (
            <TextField label="Jira project key" value={jiraProject} onChange={setJiraProject} hint="For example PAY. Filled in from the Toil project when it names one." />
          ) : (
            <TextField label="Issue keys" value={keys} onChange={setKeys} hint="Separated by spaces or commas, up to 20." />
          )}
          <p className="runs">
            Runs <code>{readLine}</code>
          </p>
          <div className="setup__actions">
            <button type="button" className="btn btn--accent" onClick={() => void read()} disabled={!ready || reading.kind === 'reading'} data-find-read="">
              {reading.kind === 'reading' ? 'Reading…' : 'Read the fields'}
            </button>
          </div>
          {reading.kind === 'reading' && <Loader size="panel" message={how === 'auto' ? `Reading one issue of each type in ${jiraProject.trim()} with toil jira field discover…` : `Reading ${issueKeys.length} issue${issueKeys.length === 1 ? '' : 's'} with toil jira field discover…`} />}
          {reading.kind === 'failed' && <OutcomeLine outcome={reading.outcome} />}
          {data && reading.kind === 'read' && (
            <>
              {reading.warnings.map((w, i) => (
                <p key={i} className="note" role="status">
                  {w}
                </p>
              ))}
              {data.fields.length === 0 && data.issueTypes.every((t) => t.status === 'sampled') && <p>No custom fields hold a value on what toil read.</p>}
              {data.issueTypes.map((t) => (
                <TypeTable key={t.name} type={t} data={data} ticked={ticked} aliases={aliases} onTick={(fid, on) => setTicked((s) => ({ ...s, [fid]: on }))} onAlias={(fid, v) => setAliases((s) => ({ ...s, [fid]: v }))} />
              ))}
              {data.fields.length > 0 && (
                <div className="find-fields__save">
                  <p className="note">{picks.length === 0 ? 'Tick the fields to name.' : `${picks.length} field${picks.length === 1 ? '' : 's'} ticked. Only the ones toil is sure of start ticked.`}</p>
                  {commands.length > 0 && (
                    <details open={commands.length <= 4}>
                      <summary>
                        Runs {commands.length} toil command{commands.length === 1 ? '' : 's'}
                      </summary>
                      <ul className="plain">
                        {commands.map((c) => (
                          <li key={c.line} className="any-break">
                            Runs <code>{c.line}</code>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {badAlias && (
                    <p className="failure" role="alert">
                      A name is a camelCase word, such as storyPoints: change “{badAlias.alias}”.
                    </p>
                  )}
                  <div className="setup__actions">
                    <button type="button" className="btn btn--accent" onClick={() => void run(commands, [])} disabled={picks.length === 0 || Boolean(badAlias) || saving || config.disabled !== null} data-find-save="">
                      {saving ? 'Naming…' : 'Name these fields'}
                    </button>
                    {config.disabled && <span className="note">Turned off: {config.disabled}</span>}
                  </div>
                </div>
              )}
              {results && (
                <ul className="plain find-fields__results" aria-label="What happened to each name">
                  {results.map((r) => (
                    <li key={r.line} className={r.ok ? 'any-break' : 'failure any-break'}>
                      <code>{r.line}</code>: {r.ok ? 'saved' : `failed. ${r.message}${r.fix ? ` Fix: ${r.fix}` : ''}`}
                    </li>
                  ))}
                </ul>
              )}
              {saved && !saving && (
                <p role="status" className="find-fields__done" data-find-done="">
                  {results!.filter((r) => r.ok).length} of {results!.length} saved{saved.file ? <> in <Path value={saved.file} what="the Toil project file" /></> : null}. Nothing was changed in Jira.
                  {failed.length > 0 && (
                    <>
                      {' '}
                      <button type="button" className="btn" onClick={retry} data-find-retry="">
                        Try the failed ones again
                      </button>
                    </>
                  )}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function TypeTable({ type, data, ticked, aliases, onTick, onAlias }: { type: Discovered['issueTypes'][number]; data: Discovered; ticked: Record<string, boolean>; aliases: Record<string, string>; onTick: (id: string, on: boolean) => void; onAlias: (id: string, v: string) => void }) {
  const rows = data.fields.filter((f) => type.fields?.includes(f.id));
  return (
    <div className="find-fields__type">
      <h4>{type.name}</h4>
      {type.status === 'no-sample' ? (
        <p className="note">No {type.name} issue was found to read, so toil can't say which fields it uses.</p>
      ) : rows.length === 0 ? (
        <p className="note">No custom field holds a value on {type.sampled?.join(', ')}.</p>
      ) : (
        <DataTable
          label={`Custom fields on ${type.name}`}
          caption={`Custom fields that hold a value on ${type.name}, read from ${type.sampled?.join(', ')}`}
          rows={rows}
          rowKey={(f) => f.id}
          columns={[
            { header: 'Name it', label: 'Name it', cell: (f) => <input type="checkbox" checked={ticked[f.id] ?? false} onChange={(e) => onTick(f.id, e.target.checked)} aria-label={`Name ${f.name} in the Toil project`} /> },
            {
              header: 'Field',
              label: 'Field',
              rowHeader: true,
              cell: (f) => (
                <>
                  {f.name} <code>{f.id}</code>
                </>
              ),
            },
            { header: 'Example', label: 'Example', cell: (f) => <span className="any-break">{f.example}</span> },
            {
              header: 'What toil thinks it is',
              label: 'What toil thinks it is',
              cell: (f) =>
                f.owi ? (
                  <>
                    {OWI_WORD[f.owi.field]}, {f.owi.confidence === 'high' ? 'sure' : 'probably'}
                    <Info label={`why toil thinks ${f.name} is ${OWI_WORD[f.owi.field]}`} text={f.owi.why} />
                  </>
                ) : (
                  <>
                    –{f.note && <Info label={`${f.name}`} text={f.note} />}
                  </>
                ),
            },
            { header: 'Its name in toil', label: 'Its name in toil', cell: (f) => <input type="text" className="find-fields__alias" value={aliases[f.id] ?? f.alias} onChange={(e) => onAlias(f.id, e.target.value)} aria-label={`Name for ${f.name} in toil`} autoComplete="off" spellCheck={false} /> },
          ]}
        />
      )}
    </div>
  );
}

/**
 * The setup wizard's optional step: the Jira connection and Toil project the
 * person just linked or chose, so there is nothing to type but the Jira project
 * key. Skippable like every step.
 */
export function FieldsStep({ config, made, existing, project, projects }: { config: ConfigApi; made: Record<string, string>; existing: Array<Pick<ConnectionRow, 'name' | 'area'>>; project: string | null; projects: string[] }) {
  const connection = made.jira ?? existing.find((c) => c.area === 'jira')?.name ?? null;
  return (
    <>
      <p>
        <strong>Optional.</strong> Skip it if you like: you can do this later under Settings, Toil projects.
      </p>
      {!connection ? (
        <p className="note" data-find-none="">
          Jira isn't linked, so there is nothing to read. Skip this step.
        </p>
      ) : !project ? (
        <p className="note" data-find-none="">
          Choose or create a Toil project first (Back), then come here. Or skip this step.
        </p>
      ) : (
        <FindFields config={config} toilProjects={projects.includes(project) ? projects : [project, ...projects]} toilProject={project} connections={[{ name: connection, area: 'jira' }]} connection={connection} />
      )}
    </>
  );
}
