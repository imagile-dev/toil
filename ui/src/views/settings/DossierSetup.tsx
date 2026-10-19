/**
 * Dossiers (#253, item 4): what `toil dossiers` builds, from the browser.
 * The list and each dossier's areas come from `dossiers list` and `dossiers
 * show`; `dossiers check` checks one without contacting any service. The
 * forms create a dossier and add to one: a repository, an area's connection
 * and keys, a field alias. A dossier holds no secret and can't turn writes
 * on, and toil refuses, from here as over MCP, a link that would point a
 * dossier at a connection with writes on: a person makes that one on the CLI.
 */

import { useCallback, useEffect, useState } from 'react';
import { pairs, type AreaInfo, type ConfigApi, type ConnectionsData } from '../../config.ts';
import type { Envelope } from '../../toil.ts';
import { AreaField, ChangeForm, CheckField, OutcomeLine, SelectField, TextField, commandLine, failedOutcome, outcomeOf, type Outcome } from './parts.tsx';

interface ListedDossier {
  name: string;
  description: string | null;
  source: string;
  file: string;
  shadowedBy: string | null;
  problems: number;
}

interface Shown {
  name: string;
  file: string;
  areas: Record<string, { connection: { value: string; source: string } | null; writes: boolean | null; env: string | null; inputs: Record<string, string>; error?: { message: string } }>;
  dossier: { repos?: Array<{ name: string; path?: string; remotes: string[] }> };
}

type Loaded<T> = { ok: true; value: T } | { ok: false; message: string };
const fromEnvelope = <T,>(e: Envelope): Loaded<T> => (e.ok ? { ok: true, value: e.data as T } : { ok: false, message: `${e.error.message}${e.error.fix ? ` ${e.error.fix}` : ''}` });

export function DossierSetup({ config }: { config: ConfigApi }) {
  const [list, setList] = useState<Loaded<{ dossiers: ListedDossier[]; places: { user: string } }> | null>(null);
  const [areas, setAreas] = useState<AreaInfo[]>([]);
  const [connections, setConnections] = useState<ConnectionsData['connections']>([]);
  const [selected, setSelected] = useState('');
  const reload = useCallback(async () => {
    try {
      setList(fromEnvelope(await config.run('dossiers list', {})));
    } catch (e) {
      setList({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }, [config]);
  useEffect(() => {
    void reload();
    config.areas().then(setAreas, () => setAreas([]));
    config.run('connections list', {}).then(
      (e) => e.ok && setConnections((e.data as ConnectionsData).connections),
      () => {},
    );
  }, [config, reload]);

  if (!list) return <p className="skin-loading">Reading your dossiers with toil dossiers list…</p>;
  if (!list.ok) {
    return (
      <div role="alert" className="failure">
        <p>
          <code>toil dossiers list</code> failed: {list.message}
        </p>
      </div>
    );
  }
  const dossiers = list.value.dossiers;
  const target = dossiers.find((d) => d.name === selected)?.name ?? dossiers[0]?.name ?? '';

  return (
    <>
      <section className="panel" aria-labelledby="dossier-list">
        <h2 id="dossier-list">Your dossiers</h2>
        <p className="lede">
          From <code>toil dossiers list</code>: your own in <code>{list.value.places.user}</code>, any folders you listed, and the ones a repository checks in. Show one to see what it gives each area; Check finds problems without contacting any service.
        </p>
        {dossiers.length === 0 ? (
          <p>toil sees no dossiers yet. Create one below.</p>
        ) : (
          <ul className="conn-cards">
            {dossiers.map((d) => (
              <li key={d.file}>
                <DossierCard dossier={d} config={config} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel" aria-labelledby="dossier-change">
        <h2 id="dossier-change">Create or change a dossier</h2>
        <p className="lede">Each form runs one <code>toil dossiers</code> command, which checks the file before writing it and refuses to add what's already there unless you tick Replace.</p>
        <InitForm config={config} onChanged={reload} />
        {dossiers.length > 0 && (
          <>
            <SelectField label="Dossier to change" value={target} onChange={setSelected} options={dossiers.map((d) => ({ value: d.name, label: `${d.name} (${d.source})` }))} hint="The forms below change this one." />
            <AddRepoForm config={config} dossier={target} />
            <LinkForm config={config} dossier={target} areas={areas} connections={connections} />
            <FieldForm config={config} dossier={target} areas={areas} />
          </>
        )}
      </section>
    </>
  );
}

function DossierCard({ dossier: d, config }: { dossier: ListedDossier; config: ConfigApi }) {
  const [shown, setShown] = useState<Loaded<Shown> | null>(null);
  const [checked, setChecked] = useState<Outcome | null>(null);
  const [problems, setProblems] = useState<Array<{ level: string; path: string; message: string }>>([]);
  const titleId = `dossier-card-${d.name}`;
  const show = async () => {
    if (shown) return setShown(null);
    try {
      setShown(fromEnvelope<Shown>(await config.run('dossiers show', { dossier: d.name })));
    } catch (e) {
      setShown({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  };
  const check = async () => {
    setChecked(null);
    try {
      const e = await config.run('dossiers check', { dossier: d.name });
      const data = e.ok ? (e.data as { ok: boolean; problems: Array<{ level: string; path: string; message: string }> }) : null;
      setProblems(data?.problems ?? []);
      setChecked(data && !data.ok ? { ok: false, message: `${d.name} has problems toil would refuse it for.`, fix: null } : outcomeOf(e, data?.problems.length ? `${d.name} checks out, with ${data.problems.length} warning${data.problems.length === 1 ? '' : 's'}.` : `${d.name} checks out: no problems.`));
    } catch (e) {
      setChecked(failedOutcome(e));
    }
  };
  return (
    <article className="conn-card" aria-labelledby={titleId}>
      <div className="conn-head">
        <h3 id={titleId}>
          <code>{d.name}</code>
        </h3>
        <ul className="conn-tags" aria-label="About this dossier">
          <li className="tag">{d.source}</li>
          {d.problems > 0 && <li className="tag tag--warn">{d.problems} problem{d.problems === 1 ? '' : 's'}</li>}
        </ul>
      </div>
      {d.description && <p>{d.description}</p>}
      <p className="note">
        <code>{d.file}</code>
        {d.shadowedBy && <> (a dossier of the same name in {d.shadowedBy} takes precedence)</>}
      </p>
      <div className="conn-actions">
        <button type="button" className="btn" aria-expanded={shown !== null} onClick={show}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="btn" onClick={check}>
          Check
        </button>
      </div>
      <OutcomeLine outcome={checked} />
      {problems.length > 0 && (
        <ul className="plain">
          {problems.map((p, i) => (
            <li key={i} className={p.level === 'error' ? 'failure' : 'note'}>
              {p.level}: <code>{p.path}</code> {p.message}
            </li>
          ))}
        </ul>
      )}
      {shown && !shown.ok && (
        <p role="alert" className="failure">
          <code>toil dossiers show {d.name}</code> failed: {shown.message}
        </p>
      )}
      {shown?.ok && <ShownDossier shown={shown.value} />}
    </article>
  );
}

function ShownDossier({ shown }: { shown: Shown }) {
  const areas = Object.entries(shown.areas);
  const repos = shown.dossier.repos ?? [];
  return (
    <div className="shown">
      <div className="table-wrap">
        <table>
          <caption className="sr-only">What {shown.name} gives each area</caption>
          <thead>
            <tr>
              <th scope="col">Area</th>
              <th scope="col">Connection</th>
              <th scope="col">Writes</th>
              <th scope="col">Inputs</th>
            </tr>
          </thead>
          <tbody>
            {areas.map(([area, a]) => (
              <tr key={area}>
                <th scope="row">{area}</th>
                <td>{a.error ? <span className="failure">{a.error.message}</span> : a.connection ? `${a.connection.value} (${a.connection.source})` : 'Your default'}</td>
                <td>{a.writes === null ? '–' : a.writes ? 'On' : 'Off'}</td>
                <td>
                  {Object.entries(a.inputs)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ') || 'None'}
                  {a.env && <span className="note"> (environment {a.env})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        Repositories: {repos.length ? repos.map((r) => `${r.name}${r.remotes[0] ? ` (${r.remotes[0]})` : ''}`).join(', ') : 'none yet'}
      </p>
    </div>
  );
}

function InitForm({ config, onChanged }: { config: ConfigApi; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <ChangeForm
      title="Create a dossier"
      explain="Makes an empty dossier for one body of work in your own folder (~/.toil/dossiers/<name>.json). Add its repositories and areas with the forms below. It refuses a name you already have."
      runs={commandLine('dossiers init', [name || '<name>', ...(description ? ['--description', '…'] : [])])}
      submit="Create dossier"
      disabled={config.disabled}
      onSubmit={async () => {
        const e = await config.run('dossiers init', { name, ...(description ? { description } : {}) });
        const outcome = outcomeOf(e, `${name} was created.`);
        if (outcome.ok) {
          setName('');
          setDescription('');
          await onChanged();
        }
        return outcome;
      }}
    >
      <TextField label="Name" value={name} onChange={setName} required hint="Lowercase letters, digits and single hyphens, e.g. payments." />
      <TextField label="Description" value={description} onChange={setDescription} hint="One line saying what the body of work is." />
    </ChangeForm>
  );
}

function AddRepoForm({ config, dossier }: { config: ConfigApi; dossier: string }) {
  const [location, setLocation] = useState('');
  const [name, setName] = useState('');
  const [replace, setReplace] = useState(false);
  return (
    <ChangeForm
      title={`Add a repository to ${dossier}`}
      explain="Records a repository by its remote URL, or by a folder on this machine (its git root and origin remote). Any credential in a remote is left out of the file. toil then picks this dossier for calls made in that repository."
      runs={commandLine('dossiers add-repo', [dossier, location || '<folder|remote>', ...(name ? ['--name', name] : []), ...(replace ? ['--replace'] : [])])}
      submit="Add repository"
      disabled={config.disabled}
      onSubmit={async () => outcomeOf(await config.run('dossiers add-repo', { dossier, location, ...(name ? { name } : {}), ...(replace ? { replace } : {}) }), `The repository was added to ${dossier}.`)}
    >
      <TextField label="Folder or remote URL" value={location} onChange={setLocation} required hint="e.g. https://git.imagile.dev/pay/payments-api.git" />
      <TextField label="Name in the dossier" value={name} onChange={setName} hint="Defaults to the folder's or remote's last part." />
      <CheckField label="Replace a repository of that name" checked={replace} onChange={setReplace} />
    </ChangeForm>
  );
}

function LinkForm({ config, dossier, areas, connections }: { config: ConfigApi; dossier: string; areas: AreaInfo[]; connections: ConnectionsData['connections'] }) {
  const [area, setArea] = useState('');
  const [connection, setConnection] = useState('');
  const [set, setSet] = useState('');
  const [add, setAdd] = useState('');
  const [replace, setReplace] = useState(false);
  const names = areas.map((a) => a.name);
  const chosen = names.includes(area) ? area : (names.includes('jira') ? 'jira' : names[0] ?? '');
  const ofArea = connections.filter((c) => c.area === chosen);
  const args = [dossier, chosen, ...(connection ? ['--connection', connection] : []), ...pairs(set).flatMap((p) => ['--set', p]), ...pairs(add).flatMap((p) => ['--add', p]), ...(replace ? ['--replace'] : [])];
  return (
    <ChangeForm
      title={`Link an area to ${dossier}`}
      explain="Attaches an area to the dossier: which of your connections its calls use (or your default), the keys it supplies to every call (project=PAY), and reference data lists (projects=FEES). toil refuses, from here, a link that would point the dossier at a connection with writes on: a person makes that one with toil dossiers link in a terminal."
      runs={commandLine('dossiers link', args)}
      submit="Link area"
      disabled={config.disabled}
      onSubmit={async () =>
        outcomeOf(
          await config.run('dossiers link', { dossier, area: chosen, ...(connection ? { connection } : {}), ...(pairs(set).length ? { set: pairs(set) } : {}), ...(pairs(add).length ? { add: pairs(add) } : {}), ...(replace ? { replace } : {}) }),
          `${chosen} was linked to ${dossier}.`,
        )
      }
    >
      <SelectField label="Area" value={chosen} onChange={(v) => (setArea(v), setConnection(''))} options={names.map((n) => ({ value: n, label: n }))} />
      <SelectField label="Connection" value={connection} onChange={setConnection} options={[{ value: '', label: `Your ${chosen} default` }, ...ofArea.map((c) => ({ value: c.name, label: `${c.name}${c.writes ? ' (writes on)' : ''}` }))]} />
      <AreaField label="Keys to set, one key=value per line" value={set} onChange={setSet} hint="The area's context inputs (project=PAY, owner=imagile) are applied to calls; any other key is kept as reference data." />
      <AreaField label="Values to add to lists, one key=value per line" value={add} onChange={setAdd} hint="e.g. projects=FEES" />
      <CheckField label="Replace values already set" checked={replace} onChange={setReplace} />
    </ChangeForm>
  );
}

function FieldForm({ config, dossier, areas }: { config: ConfigApi; dossier: string; areas: AreaInfo[] }) {
  const [area, setArea] = useState('');
  const [alias, setAlias] = useState('');
  const [id, setId] = useState('');
  const [replace, setReplace] = useState(false);
  const names = areas.map((a) => a.name);
  const chosen = names.includes(area) ? area : (names.includes('jira') ? 'jira' : names[0] ?? '');
  return (
    <ChangeForm
      title={`Name a field in ${dossier}`}
      explain="Gives one of the area's fields a friendly name in this dossier (storyPoints for customfield_10002), so commands and Toil UI's work items use the name. The OWI fields estimate, priority, type, team and dueDate are pointed at a team's own field the same way."
      runs={commandLine('dossiers field', [dossier, chosen, alias || '<alias>', id || '<field-id>', ...(replace ? ['--replace'] : [])])}
      submit="Name field"
      disabled={config.disabled}
      onSubmit={async () => outcomeOf(await config.run('dossiers field', { dossier, area: chosen, alias, id, ...(replace ? { replace } : {}) }), `${alias} now names ${id} in ${dossier}.`)}
    >
      <SelectField label="Area" value={chosen} onChange={setArea} options={names.map((n) => ({ value: n, label: n }))} />
      <TextField label="Alias" value={alias} onChange={setAlias} required hint="A camelCase name, e.g. storyPoints or estimate." />
      <TextField label="Field id" value={id} onChange={setId} required hint="The service's own id, e.g. customfield_10002." />
      <CheckField label="Point an existing alias at this field" checked={replace} onChange={setReplace} />
    </ChangeForm>
  );
}
