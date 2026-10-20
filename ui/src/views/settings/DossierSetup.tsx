/**
 * Dossiers (#253, item 4): what `toil dossiers` builds, from the browser.
 * The list and each dossier's areas come from `dossiers list` and `dossiers
 * show`; `dossiers check` checks one without contacting any service. The
 * forms create a dossier and add to one: a repository, an area's connection
 * and keys, a field alias, a person with the identity each system knows them
 * by, and the work-in-progress limit (#292). A dossier holds no secret and can't turn writes
 * on, and toil refuses, from here as over MCP, a link that would point a
 * dossier at a connection with writes on: a person makes that one on the CLI.
 */

import { useCallback, useEffect, useState } from 'react';
import { pairs, type AreaInfo, type ConfigApi, type ConnectionsData } from '../../config.ts';
import type { Envelope } from '../../toil.ts';
import { Card, CardGrid, Cluster, DataTable, Path, Stack, Url } from '../../components/layout.tsx';
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
  dossier: { repos?: Array<{ name: string; path?: string; remotes: string[] }>; people?: Array<{ name: string; kind?: string; email?: string; ids?: Record<string, string> }>; wipLimit?: number };
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
      <Card as="section" className="panel" aria-labelledby="dossier-list">
        <h2 id="dossier-list">Your dossiers</h2>
        <p className="lede">
          From <code>toil dossiers list</code>: your own in <Path value={list.value.places.user} what="folder path" />, any folders you listed, and the ones a repository checks in. Show one to see what it gives each area; Check finds problems without contacting any service.
        </p>
        {dossiers.length === 0 ? (
          <p>toil sees no dossiers yet. Create one below.</p>
        ) : (
          <CardGrid min="lg" className="conn-cards">
            {dossiers.map((d) => (
              <li key={d.file}>
                <DossierCard dossier={d} config={config} />
              </li>
            ))}
          </CardGrid>
        )}
      </Card>
      <Card as="section" className="panel" aria-labelledby="dossier-change">
        <h2 id="dossier-change">Create or change a dossier</h2>
        <p className="lede">Each form runs one <code>toil dossiers</code> command, which checks the file before writing it and refuses to add what's already there unless you tick Replace.</p>
        <InitForm config={config} onChanged={reload} />
        {dossiers.length > 0 && (
          <>
            <SelectField label="Dossier to change" value={target} onChange={setSelected} options={dossiers.map((d) => ({ value: d.name, label: `${d.name} (${d.source})` }))} hint="The forms below change this one." />
            <AddRepoForm config={config} dossier={target} />
            <LinkForm config={config} dossier={target} areas={areas} connections={connections} />
            <FieldForm config={config} dossier={target} areas={areas} />
            <PersonForm config={config} dossier={target} areas={areas} />
            <WipLimitForm config={config} dossier={target} />
          </>
        )}
      </Card>
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
    <Card className="conn-card" aria-labelledby={titleId}>
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
        <Path value={d.file} what={`${d.name}'s file path`} />
        {d.shadowedBy && <> (a dossier of the same name in {d.shadowedBy} takes precedence)</>}
      </p>
      <Cluster className="conn-actions">
        <button type="button" className="btn" aria-expanded={shown !== null} onClick={show}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <button type="button" className="btn" onClick={check}>
          Check
        </button>
      </Cluster>
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
    </Card>
  );
}

function ShownDossier({ shown }: { shown: Shown }) {
  const areas = Object.entries(shown.areas);
  const repos = shown.dossier.repos ?? [];
  return (
    <Stack className="shown" gap="sm">
      <DataTable
        label={`What ${shown.name} gives each area`}
        caption={`What ${shown.name} gives each area`}
        rows={areas}
        rowKey={([area]) => area}
        columns={[
          { header: 'Area', label: 'Area', rowHeader: true, cell: ([area]) => area },
          { header: 'Connection', label: 'Connection', cell: ([, a]) => (a.error ? <span className="failure">{a.error.message}</span> : a.connection ? `${a.connection.value} (${a.connection.source})` : 'Your default') },
          { header: 'Writes', label: 'Writes', cell: ([, a]) => (a.writes === null ? '–' : a.writes ? 'On' : 'Off') },
          {
            header: 'Inputs',
            label: 'Inputs',
            cell: ([, a]) => (
              <>
                {Object.entries(a.inputs)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(', ') || 'None'}
                {a.env && <span className="note"> (environment {a.env})</span>}
              </>
            ),
          },
        ]}
      />
      <h4 className="shown-repos">People</h4>
      {shown.dossier.people?.length ? (
        <ul className="plain">
          {shown.dossier.people.map((p) => (
            <li key={p.name} className="any-break">
              {p.name}
              {p.kind === 'agent' && ' (agent)'}
              <span className="note">
                {' '}
                {Object.entries(p.ids ?? {})
                  .map(([area, id]) => `${area} ${id}`)
                  .join(', ') || 'no identities yet'}
                {p.email && `; email ${p.email}`}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">None yet.</p>
      )}
      <p className="note">Work-in-progress limit: {shown.dossier.wipLimit === undefined ? 'none set' : `${shown.dossier.wipLimit} per person`}.</p>
      <h4 className="shown-repos">Repositories</h4>
      {repos.length ? (
        <ul className="plain">
          {repos.map((r) => (
            <li key={r.name}>
              {r.name}
              {r.remotes[0] && (
                <>
                  {' '}
                  <Url value={r.remotes[0]} what={`${r.name}'s remote URL`} />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="note">None yet.</p>
      )}
    </Stack>
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
      <TextField label="Folder or remote URL" value={location} onChange={setLocation} required hint={<>e.g. <span className="any-break">https://git.imagile.dev/pay/payments-api.git</span></>} />
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

function PersonForm({ config, dossier, areas }: { config: ConfigApi; dossier: string; areas: AreaInfo[] }) {
  const [name, setName] = useState('');
  const [ids, setIds] = useState('');
  const [kind, setKind] = useState<'human' | 'agent'>('human');
  const [email, setEmail] = useState('');
  const [replace, setReplace] = useState(false);
  const list = pairs(ids);
  const args = [dossier, name ? (/\s/.test(name) ? `"${name}"` : name) : '<name>', ...list.flatMap((p) => ['--id', p]), ...(kind === 'agent' ? ['--kind', 'agent'] : []), ...(email ? ['--email', email] : []), ...(replace ? ['--replace'] : [])];
  return (
    <ChangeForm
      title={`Add a person to ${dossier}`}
      explain={
        <>
          Says who someone is in each system, so the People view gathers their work from all of them: one area=identity per line, the user name, login or email that system shows. An agent is a person of kind agent. Their email is only compared, to suggest which accounts are theirs. Removing a person or an identity is a delete, made in a terminal with <code>toil dossiers person {dossier} &lt;name&gt; --remove</code>.
        </>
      }
      runs={commandLine('dossiers person', args)}
      submit="Add person"
      disabled={config.disabled}
      onSubmit={async () => {
        const outcome = outcomeOf(
          await config.run('dossiers person', { dossier, name, ...(list.length ? { id: list } : {}), ...(kind === 'agent' ? { kind } : {}), ...(email ? { email } : {}), ...(replace ? { replace } : {}) }),
          `${name} is in ${dossier}'s people.`,
        );
        if (outcome.ok) {
          setName('');
          setIds('');
          setEmail('');
        }
        return outcome;
      }}
    >
      <TextField label="Name" value={name} onChange={setName} required hint="As the team writes it, e.g. Pat Example." />
      <AreaField label="Identities, one area=identity per line" value={ids} onChange={setIds} hint={<>e.g. jira=pat and github=pat-ex. Areas: {areas.map((a) => a.name).join(', ') || 'the ones toil has'}.</>} />
      <SelectField label="Kind" value={kind} onChange={(v) => setKind(v === 'agent' ? 'agent' : 'human')} options={[{ value: 'human', label: 'Person' }, { value: 'agent', label: 'Agent' }]} />
      <TextField label="Email" value={email} onChange={setEmail} hint="Optional, e.g. you@example.com. Compared only, to suggest matches." />
      <CheckField label="Replace an identity, kind or email already set" checked={replace} onChange={setReplace} />
    </ChangeForm>
  );
}

function WipLimitForm({ config, dossier }: { config: ConfigApi; dossier: string }) {
  const [limit, setLimit] = useState('');
  const [replace, setReplace] = useState(false);
  const n = Number(limit);
  return (
    <ChangeForm
      title={`Set ${dossier}'s work-in-progress limit`}
      explain={
        <>
          How many items one person may have in progress at once, as the team agreed. The People view counts each person's work in progress against it, and names nobody else's. Clearing it is a delete, made in a terminal with <code>toil dossiers wip-limit {dossier} --clear</code>.
        </>
      }
      runs={commandLine('dossiers wip-limit', [dossier, limit || '<limit>', ...(replace ? ['--replace'] : [])])}
      submit="Set limit"
      disabled={config.disabled}
      onSubmit={async () => {
        if (!Number.isInteger(n) || n < 1) return { ok: false, message: 'The limit must be a whole number above 0.', fix: 'Type a number such as 3.' };
        return outcomeOf(await config.run('dossiers wip-limit', { dossier, limit: n, ...(replace ? { replace } : {}) }), `${dossier}'s limit is ${n} per person.`);
      }}
    >
      <TextField label="Limit" value={limit} onChange={setLimit} required hint="A whole number, e.g. 3." />
      <CheckField label="Replace a limit already set" checked={replace} onChange={setReplace} />
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
