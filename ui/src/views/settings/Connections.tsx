/**
 * Connections (#253, item 4): what `toil connections` manages, from the
 * browser. Each connection says its area, host, whether it's the area's
 * default, whether writes are on, and where each value comes from; each action
 * says what it does and which toil command it runs. A connection made by env
 * vars alone is shown read-only with where it came from, since no command can
 * change a variable. Secrets are typed into password fields that go straight
 * to toil's login path, and are cleared once the call is made.
 */

import { useCallback, useEffect, useState } from 'react';
import { envOnly, envPrefix, type AreaInfo, type ConfigApi, type ConnectionRow, type ConnectionsData } from '../../config.ts';
import type { Envelope } from '../../toil.ts';
import { Card, CardGrid, Path } from '../../components/layout.tsx';
import { ChangeForm, OutcomeLine, SelectField, TextField, commandLine, failedOutcome, outcomeOf, type Outcome } from './parts.tsx';

const SOURCE_WORD: Record<string, string> = { env: 'env var', ci: 'CI variable', file: 'config file', store: 'credential store', defaults: 'area defaults' };

type Loaded = { ok: true; data: ConnectionsData; warnings: string[] } | { ok: false; message: string };

function loadedFrom(envelope: Envelope): Loaded {
  if (!envelope.ok) return { ok: false, message: `${envelope.error.message}${envelope.error.fix ? ` ${envelope.error.fix}` : ''}` };
  return { ok: true, data: envelope.data as ConnectionsData, warnings: (envelope.meta.warnings ?? []).map((w) => w.message) };
}

export function Connections({ config }: { config: ConfigApi }) {
  const [list, setList] = useState<Loaded | null>(null);
  const [areas, setAreas] = useState<AreaInfo[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setList(loadedFrom(await config.run('connections list', {})));
    } catch (e) {
      setList({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  }, [config]);
  useEffect(() => {
    void reload();
    config.areas().then(setAreas, () => setAreas([]));
  }, [config, reload]);

  if (!list) return <p className="skin-loading">Reading your connections with toil connections list…</p>;
  if (!list.ok) {
    return (
      <div role="alert" className="failure">
        <p>
          <code>toil connections list</code> failed: {list.message}
        </p>
      </div>
    );
  }
  const { data } = list;
  return (
    <>
      <Card as="section" className="panel" aria-labelledby="conn-list">
        <h2 id="conn-list">Your connections</h2>
        <p className="lede">
          From <code>toil connections list</code>, which never returns a secret. Changes are written to <Path value={data.configFile} what="config file path" />; secrets live in the OS credential store.
        </p>
        {data.connections.length === 0 ? (
          <p>toil has no connections yet. Add one below.</p>
        ) : (
          <CardGrid min="lg" className="conn-cards">
            {data.connections.map((c) => (
              <li key={c.name}>
                <ConnectionCard connection={c} areas={areas ?? []} config={config} configFile={data.configFile} onChanged={reload} />
              </li>
            ))}
          </CardGrid>
        )}
      </Card>
      <AddConnection areas={areas} config={config} onChanged={reload} />
    </>
  );
}

type Action = 'test' | 'default' | 'writes' | 'login' | 'remove';

function ConnectionCard({ connection: c, areas, config, configFile, onChanged }: { connection: ConnectionRow; areas: AreaInfo[]; config: ConfigApi; configFile: string; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState<Action | null>(null);
  const [tested, setTested] = useState<Outcome | null>(null);
  const [testing, setTesting] = useState(false);
  const readOnly = envOnly(c);
  const titleId = `conn-${c.name}`;
  const secretFields = areas.find((a) => a.name === c.area)?.connection.filter((f) => f.secret) ?? [];

  const test = async () => {
    setTesting(true);
    setTested(null);
    try {
      const envelope = await config.run('connections test', { name: c.name });
      const data = envelope.ok ? (envelope.data as { live: boolean; authenticated: boolean; request: string | null }) : null;
      const done = data
        ? data.live
          ? `${c.name} answered ${data.request ?? 'its check'}${data.authenticated ? ', so its credential works.' : ', but that read needs no credential, so it shows only that the host answers.'}`
          : `toil has no live check for ${c.area} connections, so nothing was sent; the settings are complete and the secret was read.`
        : '';
      setTested(outcomeOf(envelope, done));
    } catch (e) {
      setTested(failedOutcome(e));
    } finally {
      setTesting(false);
    }
  };

  const toggle = (a: Action) => setOpen((o) => (o === a ? null : a));
  const after = async (envelope: Envelope, done: string) => {
    const outcome = outcomeOf(envelope, done);
    if (outcome.ok) await onChanged();
    return outcome;
  };

  return (
    <Card className="conn-card" aria-labelledby={titleId}>
      <div className="conn-head">
        <h3 id={titleId}>
          <code>{c.name}</code>
        </h3>
        <ul className="conn-tags" aria-label="About this connection">
          <li className="tag">{c.area}</li>
          {c.isDefault && <li className="tag tag--accent">{c.area}'s default</li>}
          <li className={`tag ${c.writes ? 'tag--warn' : ''}`}>Writes {c.writes ? 'on' : 'off'}</li>
          {readOnly && <li className="tag">Set by env vars</li>}
        </ul>
      </div>
      <dl className="facts">
        <div>
          <dt>Host</dt>
          <dd>{c.host ?? 'None set'}</dd>
        </div>
        <div>
          <dt>Values from</dt>
          <dd>
            {Object.keys(c.values).length === 0
              ? 'Nothing beyond its area'
              : Object.entries(c.values)
                  .map(([k, s]) => `${k}: ${SOURCE_WORD[s] ?? s}`)
                  .join(', ')}
          </dd>
        </div>
      </dl>
      {readOnly && (
        <p className="note">
          Made by env vars alone (<code>{envPrefix(c.name)}*</code>, or {c.area}'s own <code>TOIL_{c.area.toUpperCase().replace(/-/g, '_')}_*</code> and CI variables), not by <code>{configFile}</code>. toil's commands can't change a variable, so this connection is read-only here: change the variables where they're set. Testing it changes nothing.
        </p>
      )}
      <div className="conn-actions">
        <button type="button" className="btn" onClick={test} disabled={testing} aria-describedby={`${titleId}-test`}>
          {testing ? 'Testing…' : 'Test'}
        </button>
        {!readOnly && (
          <>
            {!c.isDefault && (
              <button type="button" className="btn" aria-expanded={open === 'default'} onClick={() => toggle('default')}>
                Make default
              </button>
            )}
            <button type="button" className="btn" aria-expanded={open === 'writes'} onClick={() => toggle('writes')}>
              {c.writes ? 'Turn writes off' : 'Turn writes on'}
            </button>
            {secretFields.length > 0 && (
              <button type="button" className="btn" aria-expanded={open === 'login'} onClick={() => toggle('login')}>
                Replace secret
              </button>
            )}
            <button type="button" className="btn" aria-expanded={open === 'remove'} onClick={() => toggle('remove')}>
              Remove
            </button>
          </>
        )}
      </div>
      <p id={`${titleId}-test`} className="note">
        Test sends {c.area}'s one cheap authenticated read, as a real command would (<code>{commandLine('connections test', [c.name])}</code>), and changes nothing.
      </p>
      <OutcomeLine outcome={tested} />
      {open === 'default' && (
        <ChangeForm
          title={`Make ${c.name} the ${c.area} default`}
          explain={`${c.area} commands use it when a call names no connection and its dossier names none. The previous default stays as it is, just no longer the default.`}
          runs={commandLine('connections default', [c.name])}
          submit="Make default"
          disabled={config.disabled}
          onSubmit={async () => after(await config.run('connections default', { name: c.name }), `${c.name} is now the ${c.area} default.`)}
        />
      )}
      {open === 'writes' && <WritesForm connection={c} config={config} after={after} />}
      {open === 'login' && <LoginForm connection={c} fields={secretFields} config={config} after={after} />}
      {open === 'remove' && (
        <ChangeForm
          title={`Remove ${c.name}`}
          explain={`Takes ${c.name} out of ${configFile} and deletes its secrets from the OS credential store, unless another connection uses them. A dossier that names it then fails until it names another. This can't be undone here: adding it again means typing its secret again.`}
          runs={commandLine('connections remove', [c.name])}
          submit={`Remove ${c.name}`}
          danger
          disabled={config.disabled}
          onSubmit={async () => after(await config.run('connections remove', { name: c.name }), `${c.name} was removed.`)}
        />
      )}
    </Card>
  );
}

function WritesForm({ connection: c, config, after }: { connection: ConnectionRow; config: ConfigApi; after: (e: Envelope, done: string) => Promise<Outcome> }) {
  const [typed, setTyped] = useState('');
  if (c.writes) {
    return (
      <ChangeForm
        title={`Turn writes off for ${c.name}`}
        explain={`Commands can no longer change anything in ${c.area} through ${c.name}, even with --allow-write. Reads carry on as before.`}
        runs={commandLine('connections writes', [c.name, 'off'])}
        submit="Turn writes off"
        disabled={config.disabled}
        onSubmit={async () => after(await config.run('connections writes', { name: c.name, state: 'off' }), `Writes are off for ${c.name}.`)}
      />
    );
  }
  return (
    <ChangeForm
      title={`Turn writes on for ${c.name}`}
      explain={
        <>
          Writes let commands change data in {c.area} through {c.name} when a call also passes <code>--allow-write</code>. Toil UI itself never writes to {c.area}: its proposals are commands for you to run. toil asks you to type the connection's name to turn writes on, here as on the terminal, and turns them on only if it matches.
        </>
      }
      runs={commandLine('connections writes', [c.name, 'on'])}
      submit="Turn writes on"
      danger
      disabled={config.disabled}
      onSubmit={async () => {
        const answer = typed;
        setTyped('');
        return after(await config.run('connections writes', { name: c.name, state: 'on' }, { answers: { 'confirm-name': answer } }), `Writes are on for ${c.name}.`);
      }}
    >
      <TextField label={`Type ${c.name} to turn them on`} value={typed} onChange={setTyped} required />
    </ChangeForm>
  );
}

function LoginForm({ connection: c, fields, config, after }: { connection: ConnectionRow; fields: AreaInfo['connection']; config: ConfigApi; after: (e: Envelope, done: string) => Promise<Outcome> }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <ChangeForm
      title={`Replace ${c.name}'s secret`}
      explain={`Stores what you type in the OS credential store, reads it back to check, and only then points ${c.name} at it and deletes the old one. A field left empty keeps its secret as it is. Toil UI doesn't keep what you type: it goes to toil in one request, and the fields are cleared.`}
      runs={commandLine('connections login', [c.name])}
      submit="Save to the credential store"
      disabled={config.disabled}
      onSubmit={async () => {
        // Every field shown is answered, an empty one with '': toil keeps that secret as it is, as on the CLI.
        const secrets = Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? '']));
        setValues({});
        return after(await config.run('connections login', { name: c.name }, { secrets }), `${c.name}'s secret was replaced in the credential store.`);
      }}
    >
      {fields.map((f) => (
        <TextField key={f.name} type="password" autoComplete="new-password" label={`${f.name}${f.description ? ` (${f.description})` : ''}`} value={values[f.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} />
      ))}
    </ChangeForm>
  );
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function AddConnection({ areas, config, onChanged }: { areas: AreaInfo[] | null; config: ConfigApi; onChanged: () => Promise<void> }) {
  const withFields = (areas ?? []).filter((a) => a.connection.length > 0);
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const chosen = withFields.find((a) => a.name === area) ?? withFields[0];
  const fields = chosen?.connection ?? [];
  const settings = fields.filter((f) => !f.secret);
  const required = settings.filter((f) => f.required);
  const optional = settings.filter((f) => !f.required);
  const secretFields = fields.filter((f) => f.secret);
  const label = (f: AreaInfo['connection'][number]) => `${f.name}${f.description ? ` (${f.description})` : ''}`;

  if (areas === null) return null;
  if (withFields.length === 0) {
    return (
      <Card as="section" className="panel" aria-labelledby="conn-add">
        <h2 id="conn-add">Add a connection</h2>
        <p>The toil this server runs doesn't say what each area's connection holds, so the page can't ask for it. Add one with <code>toil connections add</code> in a terminal.</p>
      </Card>
    );
  }
  const review = [
    `area ${chosen!.name}`,
    ...settings.filter((f) => (values[f.name] ?? '') !== '').map((f) => `${f.name} ${values[f.name]}`),
    ...secretFields.filter((f) => (secrets[f.name] ?? '') !== '').map((f) => `${f.name} to the OS credential store`),
  ].join(', ');

  return (
    <Card as="section" className="panel" aria-labelledby="conn-add">
      <h2 id="conn-add">Add a connection</h2>
      <ChangeForm
        title="A new connection"
        explain={
          <>
            Asks for what <code>toil connections add</code> asks on a terminal. The settings go into your config file and each secret into the OS credential store, never the file. The first connection to an area becomes its default. Writes start off.
          </>
        }
        runs={commandLine('connections add', [name || '<name>', '--area', chosen!.name])}
        submit="Save connection"
        disabled={config.disabled}
        onSubmit={async () => {
          if (!NAME.test(name)) return { ok: false, message: `"${name}" isn't a valid connection name.`, fix: 'Use lowercase letters, digits and single hyphens, starting with a letter, e.g. corp-jira.' };
          const answers: Record<string, string> = { confirm: 'y' };
          for (const f of settings) answers[`setting:${f.name}`] = values[f.name] ?? '';
          // Every secret field shown is answered, an empty one with '', so toil skips an empty optional one as the CLI does.
          const typed = Object.fromEntries(secretFields.map((f) => [f.name, secrets[f.name] ?? '']));
          setSecrets({});
          const envelope = await config.run('connections add', { name, area: chosen!.name }, { answers, secrets: typed });
          const outcome = outcomeOf(envelope, `${name} was added.`);
          if (outcome.ok) {
            setName('');
            setValues({});
            await onChanged();
          }
          return outcome;
        }}
      >
        <TextField label="Name" value={name} onChange={setName} required hint="Lowercase letters, digits and single hyphens, e.g. corp-jira." />
        <SelectField
          label="Area"
          value={chosen!.name}
          onChange={(v) => {
            setArea(v);
            setValues({});
            setSecrets({});
          }}
          options={withFields.map((a) => ({ value: a.name, label: a.name }))}
          hint={chosen!.description}
        />
        {required.map((f) => (
          <TextField key={f.name} label={label(f)} value={values[f.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} required placeholder={f.default ?? undefined} />
        ))}
        {secretFields.map((f) => (
          <TextField
            key={f.name}
            type="password"
            autoComplete="new-password"
            label={`${label(f)}${f.password ? ', a password' : ''}`}
            value={secrets[f.name] ?? ''}
            onChange={(v) => setSecrets((s) => ({ ...s, [f.name]: v }))}
            required={f.required}
            hint="Goes to the OS credential store; never shown again, and never in the config file."
          />
        ))}
        {optional.length > 0 && (
          <details className="more">
            <summary>Optional settings ({optional.length})</summary>
            {optional.map((f) => (
              <TextField key={f.name} label={label(f)} value={values[f.name] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} placeholder={f.default ?? undefined} hint={f.default ? `Left empty, it stays ${f.default}.` : undefined} />
            ))}
          </details>
        )}
        <p className="note">Saves: {review}.</p>
      </ChangeForm>
    </Card>
  );
}
