/**
 * The setup wizard (#561), for someone new to AI, toil and Toil UI: one
 * question a screen, seven screens, each with Back, Skip and Next and a line
 * saying where you are. The AI helper comes first and is optional: once one is
 * ready, every later step has a guide beside it that explains what the step
 * asks for (src/components/guide-panel.tsx), and with none the wizard is what
 * it always was, plus a small line offering one. It adds nothing of its own to configure. Every change
 * is a command Settings already runs through the server's allowlist:
 * `connections add` (whose masked secret fields go to toil's own login path and
 * the OS credential store, as in Settings, and nowhere else, never to the AI
 * helper), `connections test`, `projects init`, `projects add-repo` and
 * `projects link`, and the helper is the same Install dialog and Save the Agent
 * page has. The guide never sees a secret and runs nothing itself: a command it
 * suggests is run by a person pressing Run this, through the same allowlist.
 * Writes stay off, and the wizard says so. Progress lives in this
 * component's state only: close the tab and the choices go, the connections
 * already saved stay. The paperwork for a first day, minus the first day's paperwork.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RadioGroup, Radio } from 'react-aria-components';
import type { AgentSettingsPanelProps } from '../agent-settings.tsx';
import type { Agent } from '../agent.ts';
import { GuidePanel } from '../components/guide-panel.tsx';
import { guideStateOf } from '../guide.ts';
import { AdaptersCard, helperState, STATE_WORD } from '../agent-install.tsx';
import { SAMPLE_ADAPTER_STATUS } from '../fixtures/agent-status.ts';
import { envOnly, type AreaInfo, type ConfigApi, type ConnectionRow, type ConnectionsData } from '../config.ts';
import type { AgentStatus } from '../server-client.ts';
import { Card, Copy } from '../components/layout.tsx';
import { Help } from '../components/help.tsx';
import { Loader } from '../moments/Moments.tsx';
import { deploymentOf, freeName, groupAreas, GUIDED_STEPS, locationKind, locationProblems, projectFile, SETUP_STEPS, STEP_TITLE, terminalAdd, toolName, TOKEN_WORD, tokenState, type SetupStep } from '../setup.ts';
import { LoginForm, NewConnectionForm } from './settings/Connections.tsx';
import { FieldsStep } from './settings/FindFields.tsx';
import { ChangeForm, ChoiceRadios, OutcomeLine, SelectField, TextField, commandLine, failedOutcome, outcomeOf, type Outcome } from './settings/parts.tsx';
import './setup.css';

/** Where the wizard lives, and what opens it from the first run, the palette and Settings. */
export const SETUP_HREF = '#/setup';

interface ListedProject {
  name: string;
  description: string | null;
}

/** The AI helper the person saved in the wizard, if any. */
type Chosen = string | null;

export interface SetupProps {
  config: ConfigApi | null;
  /** Toil UI's AI helper settings; absent in the preview, which shows the sample status and installs nothing. */
  agent?: AgentSettingsPanelProps | undefined;
  /** The setup guide's question, when this Toil UI has one: the server's, or the preview's scripted one. Absent: no guide, and no offer of one. */
  guide?: Agent['guide'] | undefined;
  onSync?: (() => void) | undefined;
}

/** Whether the saved choice names a helper that can start now: a chosen one that is installed with its program found. */
const helperReady = (status: AgentStatus | null): boolean => Boolean(status && status.settings.adapter !== 'none' && status.adapters.some((a) => a.name === status.settings.adapter && helperState(a) === 'ready'));

export function Setup({ config, agent, guide, onSync }: SetupProps) {
  const [step, setStep] = useState<SetupStep>('welcome');
  const [areas, setAreas] = useState<AreaInfo[] | null>(null);
  const [connections, setConnections] = useState<ConnectionsData['connections']>([]);
  /** Whether `connections list` was read: an unreadable list is unknown, not empty. */
  const [configFile, setConfigFile] = useState<string | null>(null);
  const [listed, setListed] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<ListedProject[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [areaAt, setAreaAt] = useState(0);
  /** Connections saved in this run, by area. */
  const [made, setMade] = useState<Record<string, string>>({});
  const [project, setProject] = useState<string | null>(null);
  const [helper, setHelper] = useState<Chosen>(null);
  /** The non-secret settings the connection form would send now, for the guide: the form reports them, and holds the secret box to itself. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** The step a person left to set up a helper from the offer, so Next takes them back to it. */
  const [returnTo, setReturnTo] = useState<SetupStep | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusProblem, setStatusProblem] = useState<string | null>(null);
  const client = agent?.client ?? null;
  const readStatus = useCallback(() => {
    client?.status().then(setStatus, (e: unknown) => setStatusProblem(e instanceof Error ? e.message : String(e)));
  }, [client]);
  useEffect(readStatus, [readStatus]);
  const heading = useRef<HTMLHeadingElement>(null);

  const reload = useCallback(async () => {
    if (!config) return;
    const [list, ps] = await Promise.all([config.run('connections list', {}).catch(() => null), config.run('projects list', {}).catch(() => null)]);
    setListed(Boolean(list?.ok));
    if (list?.ok) {
      setConnections((list.data as ConnectionsData).connections);
      setConfigFile((list.data as ConnectionsData).configFile);
    }
    if (ps?.ok) setProjects((ps.data as { toilProjects: ListedProject[] }).toilProjects ?? []);
  }, [config]);
  useEffect(() => {
    if (!config) return;
    config.areas().then(setAreas, () => setAreas([]));
    void reload();
  }, [config, reload]);
  useEffect(() => heading.current?.focus(), [step, areaAt]);
  useEffect(() => setDraft({}), [step, areaAt]);

  const index = SETUP_STEPS.indexOf(step);
  const next = () => {
    if (step === 'helper' && returnTo) {
      setStep(returnTo);
      return setReturnTo(null);
    }
    if (step === 'connect' && areaAt < picked.length - 1) return setAreaAt(areaAt + 1);
    if (step === 'tools' && picked.length === 0) return setStep('project');
    setAreaAt(0);
    setStep(SETUP_STEPS[Math.min(index + 1, SETUP_STEPS.length - 1)]!);
  };
  const back = () => {
    if (step === 'connect' && areaAt > 0) return setAreaAt(areaAt - 1);
    if (step === 'project' && picked.length === 0) return setStep('tools');
    if (step === 'project') setAreaAt(picked.length - 1);
    setStep(SETUP_STEPS[Math.max(index - 1, 0)]!);
  };

  const tools = areas ? groupAreas(areas) : null;
  const area = picked[areaAt];
  const sub = step === 'connect' && picked.length > 1 ? ` (${areaAt + 1} of ${picked.length})` : '';
  const title = step === 'connect' && area ? `Link ${toolName(area)}${sub}` : STEP_TITLE[step];
  // The preview has no helper to set up, so its scripted guide is ready; anywhere else a helper must be chosen and able to start.
  const ready = client ? helperReady(status) : guide !== undefined;
  const guided = guide !== undefined && GUIDED_STEPS.includes(step);
  return (
    <div className="setup" data-setup={step}>
      <div className="view-head">
        <p className="eyebrow">Setup</p>
        <p className="setup__progress" role="status">
          Step {index + 1} of {SETUP_STEPS.length}
          <progress className="setup__bar" value={index + 1} max={SETUP_STEPS.length} aria-label="Setup progress" />
        </p>
      </div>
      <div className="setup__layout" {...(guided && ready ? { 'data-guided': '' } : {})}>
      <Card as="section" className="panel setup__card" aria-labelledby="setup-title">
        <div className="setup__title">
          <h1 id="setup-title" tabIndex={-1} ref={heading}>
            {title}
          </h1>
          <Help topic="setup" />
        </div>
        {guided && !ready && (
          <p className="note setup__offer" data-setup-guide-offer="">
            Set up an AI helper to get explanations here.
            <button type="button" className="btn btn--small" onClick={() => (setReturnTo(step), setStep('helper'))}>
              Set up an AI helper
            </button>
          </p>
        )}
        {step === 'welcome' && <Welcome />}
        {step === 'tools' && (!config ? <NoConfig /> : !tools ? <Loader size="panel" message="Reading the tools toil knows about…" /> : <Tools tools={tools} connections={connections} picked={picked} onPick={setPicked} />)}
        {step === 'connect' && config && area && areas && (
          <ConnectOne key={area} config={config} areas={areas} area={area} rows={connections.filter((c) => c.area === area)} known={listed !== false} allNames={connections.map((c) => c.name)} made={made[area] ?? null} onMade={async (name) => (setMade((m) => ({ ...m, [area]: name })), reload())} onDraft={setDraft} />
        )}
        {step === 'project' && (config ? <ProjectStep config={config} configFile={configFile} projects={projects} made={made} existing={connections} picked={picked} chosen={project} onChosen={setProject} reload={reload} /> : <NoConfig />)}
        {step === 'fields' && (config ? <FieldsStep config={config} made={made} existing={connections} project={project} projects={projects.map((p) => p.name)} /> : <NoConfig />)}
        {step === 'helper' && <HelperStep agent={agent} status={status} problem={statusProblem} onStatus={setStatus} refresh={readStatus} onChosen={setHelper} />}
        {step === 'done' && <Done made={made} project={project} helper={helper} onSync={onSync} />}
        <nav className="setup__nav" aria-label="Setup steps">
          {step !== 'welcome' && (
            <button type="button" className="btn" onClick={back} data-setup-back="">
              Back
            </button>
          )}
          {step !== 'welcome' && step !== 'done' && (
            <button type="button" className="btn" onClick={next} data-setup-skip="">
              Skip
            </button>
          )}
          {step !== 'done' && (
            <button type="button" className="btn btn--accent" onClick={next} data-setup-next="">
              {step === 'welcome' ? 'Start' : 'Next'}
            </button>
          )}
        </nav>
      </Card>
      {guided && ready && guide && <GuidePanel guide={guide} config={config} state={guideStateOf({ step, areas: picked, area: step === 'connect' ? area : undefined, draft, project })} onRan={() => void reload()} />}
      </div>
    </div>
  );
}

const NoConfig = () => <p className="failure">This app wasn't given toil's configuration commands, so there is nothing to set up here. Run toil in a terminal instead.</p>;

function Welcome() {
  return (
    <>
      <p>
        <strong>toil</strong> reads the tools your team already uses, such as Jira, GitHub and Azure DevOps, and gives you one picture of the work. <strong>Toil UI</strong> is this page: it shows that picture and lets an AI helper answer questions about it.
      </p>
      <p>This takes a few minutes. You will link the tools you use, group them into a Toil project, and, if you like, add an AI helper.</p>
      <p className="note" data-setup-promise="">
        Nothing is changed in your tools without you. Every link starts read-only, you can skip any step, and you can come back to this page from the command palette or from Settings.
      </p>
    </>
  );
}

function Tools({ tools, connections, picked, onPick }: { tools: ReturnType<typeof groupAreas>; connections: ConnectionsData['connections']; picked: string[]; onPick: (a: string[]) => void }) {
  const toggle = (name: string) => onPick(picked.includes(name) ? picked.filter((p) => p !== name) : [...picked, name]);
  const row = (a: AreaInfo) => {
    const have = connections.filter((c) => c.area === a.name).map((c) => c.name);
    return (
      <li key={a.name} className="setup__tool">
        <label>
          <input type="checkbox" checked={picked.includes(a.name)} onChange={() => toggle(a.name)} data-setup-tool={a.name} />
          <span>
            <strong>{toolName(a.name)}</strong>
            {have.length > 0 && <span className="tag tag--accent">Already linked: {have.join(', ')}</span>}
            <span className="note">{a.description}</span>
          </span>
        </label>
      </li>
    );
  };
  return (
    <fieldset className="setup__tools">
      <legend>Tick every tool you use. You can add more later in Settings.</legend>
      <ul className="plain">{tools.common.map(row)}</ul>
      {tools.more.length > 0 && (
        <details className="more" data-setup-more="">
          <summary>More tools ({tools.more.length})</summary>
          <ul className="plain">{tools.more.map(row)}</ul>
        </details>
      )}
    </fieldset>
  );
}

type Mode = 'use' | 'replace' | 'add';

/**
 * One tool's step: first what already exists, read from `connections list`
 * (which says where each value lives and never what it is), then one choice.
 * Use what is there, replace its saved token on purpose, or add another under a
 * name nothing has. Saving over a connection by accident is not on the menu:
 * the form refuses a name that is taken, and Replace has its own tick box.
 * `known` is false when the list could not be read, which is not the same as
 * there being none, so the screen says so.
 */
function ConnectOne({ config, areas, area, rows, known, allNames, made, onMade, onDraft }: { config: ConfigApi; areas: AreaInfo[]; area: string; rows: ConnectionRow[]; known: boolean; allNames: string[]; made: string | null; onMade: (name: string) => Promise<void>; onDraft: (settings: Record<string, string>) => void }) {
  const info = areas.find((a) => a.name === area);
  const secretFields = info?.connection.filter((f) => f.secret) ?? [];
  const states = rows.map((r) => ({ row: r, token: tokenState(r, secretFields.map((f) => f.name)) }));
  const good = states.filter((s) => s.token !== 'missing');
  const [target, setTarget] = useState((rows.find((r) => r.isDefault) ?? rows[0])?.name ?? '');
  const [mode, setMode] = useState<Mode | null>(rows.length === 0 ? 'add' : good.length === 1 ? 'use' : null);
  const [tested, setTested] = useState<Outcome | null>(null);
  const [testing, setTesting] = useState(false);
  const [draft, setDraft] = useState('');
  const current = rows.find((r) => r.name === target) ?? rows[0];
  const name = made ?? (mode === 'use' ? (current?.name ?? null) : null);
  const test = async () => {
    if (!name) return;
    setTesting(true);
    setTested(null);
    try {
      const e = await config.run('connections test', { name });
      const d = e.ok ? (e.data as { live: boolean; authenticated: boolean; request: string | null }) : null;
      setTested(outcomeOf(e, d ? (d.live ? `${toolName(area)} answered, so the link works${d.authenticated ? ' and the login is accepted' : ''}.` : `toil has no live check for ${toolName(area)}; the settings are complete.`) : ''));
    } catch (e) {
      setTested(failedOutcome(e));
    } finally {
      setTesting(false);
    }
  };
  const canReplace = current !== undefined && !envOnly(current) && secretFields.length > 0;
  const modes = [
    ...(current ? [{ key: 'use', label: `Use ${current.name} (already set up)`, note: 'Keeps everything as it is and goes on to test it.' }] : []),
    ...(canReplace ? [{ key: 'replace', label: `Replace the saved token for ${current.name}`, note: 'Overwrites the token in the secure store on this computer. You confirm before anything is saved.' }] : []),
    ...(current ? [{ key: 'add', label: `Add another ${toolName(area)} connection`, note: 'Under a new name. Nothing existing is touched.' }] : []),
  ];
  return (
    <>
      {config.disabled && (
        <p className="config-off">
          <strong>Changes are turned off.</strong> {config.disabled}
        </p>
      )}
      {!known && (
        <p className="note" data-setup-unknown="">
          <span aria-label="not read yet">–</span> toil couldn't read your existing connections, so this page can't say whether you already have a {toolName(area)} one. A name that is already taken is refused when you save.
        </p>
      )}
      {rows.length > 0 && (
        <section aria-label={`Existing ${toolName(area)} connections`} data-setup-existing="">
          <p>
            You already have {rows.length} {toolName(area)} connection{rows.length === 1 ? '' : 's'}:
          </p>
          <ul className="plain setup__existing">
            {states.map(({ row, token }) => (
              <li key={row.name} data-existing={row.name}>
                <strong>{row.name}</strong>
                {row.isDefault && <span className="tag"> default</span>}
                {row.host && <span className="note"> {row.host}</span>}
                {info && deploymentOf(info, row) && <span className="note"> ({deploymentOf(info, row)})</span>}
                <span className="note" title="In toil: writes"> changes {row.writes ? 'on' : 'off'}</span>
                <span className={`tag tag--${token}`} data-token={token}>
                  {' '}
                  token: {TOKEN_WORD[token]}
                </span>
                {envOnly(row) && <span className="note"> Set by environment variables; this page can't change it.</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {rows.length > 1 && (
        <SelectField label="Which one" value={current?.name ?? ''} onChange={setTarget} options={rows.map((r) => ({ value: r.name, label: r.name }))} />
      )}
      {rows.length > 0 && !made && <ChoiceRadios label="What would you like to do?" field="existing-mode" selected={mode} onChange={(k) => (setMode(k as Mode), setTested(null))} options={modes} />}
      {(name && (mode === 'use' || made)) ? (
        <div data-setup-linked={name}>
          <p>
            {made ? <>Saved as <code>{made}</code>. <strong>It can only read.</strong></> : <><strong>It can only read</strong> unless you turned writes on.</>} Changes to {toolName(area)} stay off until you turn them on yourself in Settings.
          </p>
          <div className="setup__actions">
            <button type="button" className="btn" onClick={test} disabled={testing} data-setup-test="">
              {testing ? 'Testing…' : 'Test the link'}
            </button>
          </div>
          <OutcomeLine outcome={tested} />
          <p className="note">
            If the test says the login is missing, enter it from Settings, Connections, Update login, or on a terminal: <code>toil connections login {name}</code> <Copy value={`toil connections login ${name}`} what="login command" />
          </p>
        </div>
      ) : mode === 'replace' && current ? (
        <div data-setup-replace={current.name}>
          <p>
            <strong>This replaces the token saved for {current.name}.</strong> The old token can't be recovered from toil.
          </p>
          <LoginForm
            connection={current}
            fields={secretFields}
            config={config}
            confirm={`Yes, replace the saved token for ${current.name}`}
            after={async (e, done) => {
              const o = outcomeOf(e, done);
              if (o.ok) await onMade(current.name);
              return o;
            }}
          />
        </div>
      ) : mode === 'add' ? (
        <>
          <p>
            Fill in where {toolName(area)} lives and your login. The login is typed into a masked box and goes straight to this computer's secure store through toil; it is never kept by this page, never shown again, and never seen by the AI helper or its guide. Changes to {toolName(area)} start <strong>off</strong>.
          </p>
          <h2 className="sr-only">Details for {toolName(area)}</h2>
          <NewConnectionForm areas={areas} config={config} area={area} title={`Link ${toolName(area)}`} suggest={{ name: freeName(area, allNames) }} existingNames={allNames} onAdded={onMade} onDraft={onDraft} />
          <details className="more" data-setup-terminal="">
            <summary>Prefer to type it on a terminal?</summary>
            <TextField label="Name for the link" value={draft} onChange={setDraft} />
            <p className="note">
              <code>{terminalAdd(draft || freeName(area, allNames), area)}</code> <Copy value={terminalAdd(draft || freeName(area, allNames), area)} what="terminal command" />
            </p>
            <p className="note">It asks for the same things, and keeps the login in the same secure store.</p>
          </details>
        </>
      ) : null}
    </>
  );
}

/** What `projects add-repo` was asked and what it said, per location. */
interface RepoResult {
  location: string;
  ok: boolean;
  message: string;
}

/**
 * Makes a Toil project in the person's own home and records where its code
 * lives. `projects init <name>` writes one file, `<home>/.toil/projects/<name>.json`;
 * each `projects add-repo` adds a path inside that file, so toil can tell which
 * Toil project a folder belongs to. Nothing is written in any folder or
 * repository, and the wizard never passes `--shared`: that would write into a
 * repository, and it is a decision for a team, made on the Toil project page.
 */
function NewProject({ config, configFile, link, onChosen, reload }: { config: ConfigApi; configFile: string | null; link: (name: string) => Promise<Outcome>; onChosen: (n: string | null) => void; reload: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<string[]>(['']);
  const [results, setResults] = useState<RepoResult[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const dupes = locationProblems(rows);
  const filled = rows.map((r) => r.trim()).filter((r) => r !== '');
  const file = projectFile(configFile, name);
  const commands = [commandLine('projects init', [name || '<name>']), ...filled.map((r) => commandLine('projects add-repo', [name || '<name>', r]))];
  const addAll = async (toilProject: string, locations: string[]): Promise<RepoResult[]> => {
    const out: RepoResult[] = [];
    for (const location of locations) {
      const o = outcomeOf(await config.run('projects add-repo', { toilProject, location }), '');
      out.push({ location, ok: o.ok, message: o.ok ? 'added' : `${o.message}${!o.ok && o.fix ? ` ${o.fix}` : ''}` });
    }
    return out;
  };
  const retry = async () => {
    const again = await addAll(saved ?? name, results.filter((r) => !r.ok).map((r) => r.location));
    setResults((cur) => cur.map((r) => again.find((a) => a.location === r.location) ?? r));
  };
  return (
    <>
      <h2 className="sr-only">A new Toil project</h2>
      <ChangeForm
        title="Create a Toil project"
        explain="Makes your own Toil project, links the tools you set up to it, and records the folders or repositories you give."
        runs={commands.join(' && ')}
        submit="Create Toil project"
        disabled={config.disabled}
        blockedBy={name === '' ? 'Name the Toil project first.' : dupes.some(Boolean) ? 'Remove the repeated folder or address first.' : null}
        onSubmit={async () => {
          const e = await config.run('projects init', { name, ...(description ? { description } : {}) });
          const created = outcomeOf(e, `${name} was created.`);
          if (!created.ok) return created;
          setSaved(name);
          const r = await addAll(name, filled);
          setResults(r);
          const l = await link(name);
          onChosen(name);
          await reload();
          const bad = r.filter((x) => !x.ok);
          const prefix = `${name} was created.${bad.length ? ` ${bad.length} of ${r.length} folders or addresses were not added, listed below.` : ''}`;
          return l.ok ? { ...l, message: `${prefix} ${l.message}` } : { ...l, message: `${prefix} Linking failed: ${l.message}` };
        }}
      >
        <TextField label="Name" value={name} onChange={setName} required hint="Lowercase letters, digits and single hyphens, e.g. payments." />
        <TextField label="What is it? (optional)" value={description} onChange={setDescription} />
        <fieldset className="repo-list" data-setup-repos="">
          <legend>Folders or repository addresses (optional)</legend>
          {rows.map((value, i) => {
            const kind = locationKind(value);
            return (
              <div key={i} className="repo-row">
                <TextField
                  label={`Folder or address ${i + 1}`}
                  value={value}
                  onChange={(v) => setRows((rs) => rs.map((r, j) => (j === i ? v : r)))}
                  hint={dupes[i] ?? (kind === 'empty' ? undefined : kind === 'address' ? 'Read as a repository address.' : 'Read as a folder path. This page cannot see your disk, so toil checks it when it is used.')}
                />
                {rows.length > 1 && (
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove folder or address ${i + 1}`}>
                    Remove
                  </button>
                )}
              </div>
            );
          })}
          <button type="button" className="btn btn--small" onClick={() => setRows((rs) => [...rs, ''])}>
            Add another
          </button>
          <p className="note" data-setup-repos-help="">
            Lets toil infer your project from the path of where you are working. Doesn't write any configuration to this path.
          </p>
        </fieldset>
        <p className="note" data-setup-writes="">
          Creating it writes one file, <code>{file}</code>, in your own home. Nothing is saved in any folder or repository you list; toil only remembers the path inside that file.
        </p>
      </ChangeForm>
      {saved && (
        <section data-setup-saved="" aria-label="What was saved">
          <h3>What was saved</h3>
          <ul className="plain">
            <li>
              <code>{projectFile(configFile, saved)}</code>
            </li>
            <li className="note">Nothing in any repository or folder.</li>
          </ul>
          {results.length > 0 && (
            <ul className="plain" data-setup-repo-results="">
              {results.map((r) => (
                <li key={r.location} className={r.ok ? 'note' : 'failure'}>
                  <code>{r.location}</code>: {r.message}
                </li>
              ))}
            </ul>
          )}
          {results.some((r) => !r.ok) && (
            <button type="button" className="btn btn--small" onClick={retry} data-setup-retry="">
              Retry the ones that failed
            </button>
          )}
        </section>
      )}
    </>
  );
}

function ProjectStep({ config, configFile, projects, made, existing, picked, chosen, onChosen, reload }: { config: ConfigApi; configFile: string | null; projects: ListedProject[]; made: Record<string, string>; existing: ConnectionsData['connections']; picked: string[]; chosen: string | null; onChosen: (n: string | null) => void; reload: () => Promise<void> }) {
  const [mode, setMode] = useState<string>(projects.length > 0 ? (chosen ?? projects[0]!.name) : '+new');
  const [linked, setLinked] = useState<Outcome | null>(null);
  // The connection each picked area would use: the one made here, else the first the person already had.
  const links = picked.flatMap((a) => {
    const c = made[a] ?? existing.find((e) => e.area === a)?.name;
    return c ? [{ area: a, connection: c }] : [];
  });
  const linkAll = async (toilProject: string): Promise<Outcome> => {
    for (const l of links) {
      const e = await config.run('projects link', { toilProject, area: l.area, connection: l.connection });
      if (!e.ok) return outcomeOf(e, '');
    }
    return { ok: true, message: links.length ? `${links.map((l) => toolName(l.area)).join(', ')} linked to ${toilProject}.` : `${toilProject} is ready.`, warnings: [] };
  };
  useEffect(() => {
    if (mode !== '+new') onChosen(mode);
  }, [mode, onChosen]);
  return (
    <>
      {config.disabled && (
        <p className="config-off">
          <strong>Changes are turned off.</strong> {config.disabled}
        </p>
      )}
      <p>A Toil project is one body of work, such as a product or a team's backlog: the tools it reads from and the repositories it covers.</p>
      {projects.length > 0 && (
        <RadioGroup className="agent-adapters" value={mode} aria-label="Which Toil project" onChange={(v) => (setMode(v), v === '+new' && onChosen(null))}>
          {projects.map((p) => (
            <Radio key={p.name} value={p.name} className="agent-choice">
              <strong>Use {p.name}</strong>
              {p.description && <span className="note">{p.description}</span>}
            </Radio>
          ))}
          <Radio value="+new" className="agent-choice">
            <strong>Create a new Toil project</strong>
          </Radio>
        </RadioGroup>
      )}
      {mode === '+new' ? (
        <NewProject config={config} configFile={configFile} link={linkAll} onChosen={onChosen} reload={reload} />
      ) : (
        <>
          {links.length > 0 && (
            <div className="setup__actions">
              <button type="button" className="btn" data-setup-link="" onClick={async () => setLinked(await linkAll(mode).catch(failedOutcome))} disabled={config.disabled !== null}>
                Link {links.map((l) => toolName(l.area)).join(', ')} to {mode}
              </button>
            </div>
          )}
          <OutcomeLine outcome={linked} />
        </>
      )}
    </>
  );
}

/**
 * The AI helper step, first after the welcome so that the guide can explain the
 * rest. For someone who has never used one: what it is, that it only reads and
 * suggests, and that it runs on the subscription they already have, so no key is
 * stored here. The status is the wizard's own (it also decides whether a guide
 * shows), so Install and Save here and the guide beside later steps agree.
 */
function HelperStep({ agent, status, problem: statusProblem, onStatus, refresh, onChosen }: { agent: AgentSettingsPanelProps | undefined; status: AgentStatus | null; problem: string | null; onStatus: (s: AgentStatus) => void; refresh: () => void; onChosen: (c: Chosen) => void }) {
  const [saveProblem, setSaveProblem] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [saved, setSaved] = useState('');
  const client = agent?.client ?? null;
  const problem = saveProblem ?? statusProblem;
  // The choice already saved is the one offered, so coming back to this step shows what is true.
  const chosen = status && status.settings.adapter !== 'none' ? status.settings.adapter : '';
  const picked = pick || chosen;
  const save = async () => {
    if (!client || !status || !picked) return;
    const s = status.settings;
    const name = picked as Exclude<typeof s.adapter, 'none'>;
    try {
      const next = await client.save({ ...s, adapter: name, model: s.models[name] ?? null, cliPath: s.cliPaths[name] ?? null, endpoint: name === 'claude' ? s.endpoint : null });
      onStatus(next);
      agent?.onChange?.(next);
      const label = next.adapters.find((a) => a.name === name)?.label ?? name;
      setSaved(`Saved: ${label} will answer your questions, and explain the next steps beside them.`);
      setSaveProblem(null);
      onChosen(label);
    } catch (e) {
      setSaveProblem(e instanceof Error ? e.message : String(e));
    }
  };
  const ready = status?.adapters.filter((a) => helperState(a) === 'ready') ?? [];
  return (
    <>
      <p>
        An <strong>AI helper</strong> is a program on your computer that can read and write plain sentences, such as Claude, GitHub Copilot or Codex. You may already use one. Set one up now and it can explain each of the next steps, right beside the form, in plain words.
      </p>
      <ul className="plain" data-setup-helper-facts="">
        <li>It only reads and suggests. It can't change anything: a change it suggests comes back as a command, and you press Run this.</li>
        <li>It uses the subscription you already have and signs in the way it already does, so Toil UI stores no key.</li>
        <li>It never sees your login. A token goes only in the masked box in the step, never to the helper.</li>
      </ul>
      <p className="note" data-setup-optional="">
        This is optional. Everything else works without one, and you can add it later under Settings, AI helper. Skip this step and the next ones look as they always did, with a small line offering to set one up.
      </p>
      {problem && (
        <p role="alert" className="failure">
          {problem}
        </p>
      )}
      {!client ? (
        <AdaptersCard adapters={SAMPLE_ADAPTER_STATUS} client={null} />
      ) : status ? (
        <>
          <AdaptersCard adapters={status.adapters} client={client} onInstalled={refresh} />
          {ready.length > 0 && (
            <>
              <RadioGroup className="agent-adapters" value={picked} aria-label="Which AI helper answers" onChange={setPick}>
                {ready.map((a) => (
                  <Radio key={a.name} value={a.name} className="agent-choice">
                    <strong>{a.label}</strong>
                    <span className="note">{STATE_WORD[helperState(a)]}</span>
                  </Radio>
                ))}
              </RadioGroup>
              <div className="setup__actions">
                <button type="button" className="btn" onClick={() => void save()} disabled={!picked} data-setup-helper-save="">
                  Use this helper
                </button>
                <span role="status" className="note">
                  {saved}
                </span>
              </div>
            </>
          )}
        </>
      ) : (
        !problem && <p className="note">Looking for AI helpers on this computer…</p>
      )}
    </>
  );
}

function Done({ made, project, helper, onSync }: { made: Record<string, string>; project: string | null; helper: Chosen; onSync: (() => void) | undefined }) {
  const names = Object.entries(made);
  return (
    <>
      <ul className="setup__summary" aria-label="What was set up">
        <li>{names.length ? `Linked: ${names.map(([a, n]) => `${toolName(a)} (${n}), read-only`).join(', ')}.` : 'No new tool links this time.'}</li>
        <li>{project ? `Toil project: ${project}.` : 'No Toil project chosen yet.'}</li>
        <li>{helper ? `AI helper: ${helper}.` : 'No AI helper, which is fine.'}</li>
      </ul>
      <p className="note">Nothing in your tools was changed, and changes stay off until you turn them on.</p>
      <div className="setup__actions">
        {onSync && (
          <button type="button" className="btn btn--accent" onClick={onSync} data-setup-sync="">
            Sync now
          </button>
        )}
        <a className="btn" href="#/">
          Open your Toil projects
        </a>
        <a className="btn" href="#/settings/connections">
          Settings
        </a>
      </div>
      <p className="note">Sync reads each Toil project once and keeps a copy on this computer, so the pages open instantly.</p>
    </>
  );
}
