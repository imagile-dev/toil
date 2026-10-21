/**
 * Set up this repo (#333): what `toil dossiers onboard` does on a terminal,
 * from the browser. Check this repo runs it with `plan`, which asks nothing
 * and adds nothing: per area of the repository's dossier it says which of
 * your connections a call would use, or that none or several fit, then runs
 * `dossiers check` and one test read per connection. A missing connection is
 * added with `toil connections add`, its base URL offered from the dossier's
 * host; where several fit, the one picked is pinned in your own copy of the
 * dossier (`--pin`). Each step runs one toil command and the check runs
 * again after it, so the table is always toil's own answer. The checklist
 * has a checklist, which is the most onboarding has ever had.
 */

import { useState, type FormEvent } from 'react';
import type { AreaInfo, ConfigApi } from '../../config.ts';
import type { Envelope } from '../../toil.ts';
import { Card, DataTable, Path, Stack } from '../../components/layout.tsx';
import { NewConnectionForm } from './Connections.tsx';
import { ChangeForm, OutcomeLine, SelectField, TextField, commandLine, failedOutcome, type Outcome } from './parts.tsx';

/** One area as `dossiers onboard` reports it. */
export interface OnboardArea {
  area: string;
  env: string | null;
  path: string;
  selects: { host: string } | { connection: string } | { default: true };
  status: 'matched' | 'default' | 'created' | 'pinned' | 'missing' | 'ambiguous';
  connection: string | null;
  candidates?: string[];
  problem?: { code: string; message: string; fix?: string };
  suggest?: { name: string; baseUrl?: string };
  test: { ok: boolean; request?: string | null; live?: boolean; error?: { code: string; message: string; fix?: string } } | null;
}

export interface OnboardPlan {
  dossier: { name: string; source: string; file: string };
  ownCopy: string | null;
  plan: boolean;
  ok: boolean;
  areas: OnboardArea[];
  check: { ok: boolean; problems: Array<{ level: string; code: string; path: string; message: string }> };
}

type Loaded = { ok: true; plan: OnboardPlan; warnings: string[] } | { ok: false; message: string; fix: string | null };

const STATUS: Record<OnboardArea['status'], string> = {
  matched: 'Ready',
  default: 'Ready (your default)',
  created: 'Added',
  pinned: 'Pinned in your copy',
  missing: 'No connection yet',
  ambiguous: 'Several fit: pick one',
};

const selectsText = (s: OnboardArea['selects']) => ('host' in s ? `host ${s.host}` : 'connection' in s ? `connection ${s.connection}` : 'your default');

function loaded(envelope: Envelope): Loaded {
  if (!envelope.ok) return { ok: false, message: envelope.error.message, fix: envelope.error.fix ?? null };
  return { ok: true, plan: envelope.data as OnboardPlan, warnings: (envelope.meta.warnings ?? []).map((w) => w.message) };
}

export function RepoSetup({ config, areas, onChanged }: { config: ConfigApi; areas: AreaInfo[]; onChanged: () => Promise<void> }) {
  const [cwd, setCwd] = useState('');
  const [dossier, setDossier] = useState('');
  const [result, setResult] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const where = { ...(cwd.trim() ? { cwd: cwd.trim() } : {}), ...(dossier.trim() ? { dossier: dossier.trim() } : {}) };
  const run = async (extra: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      const next = loaded(await config.run('dossiers onboard', { ...where, plan: true, ...extra }));
      setResult(next);
      return next;
    } catch (e) {
      const failed = failedOutcome(e);
      const next: Loaded = { ok: false, message: failed.message, fix: null };
      setResult(next);
      return next;
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) void run();
  };
  const args = [...(where.dossier ? [where.dossier] : []), ...(where.cwd ? ['--cwd', where.cwd] : []), '--plan'];

  return (
    <Card as="section" className="panel" aria-labelledby="repo-setup">
      <h2 id="repo-setup">Set up this repo</h2>
      <p className="lede">
        For a repository with a dossier checked in: which of your connections each of its areas would use, the ones you still need, and a test read through each. It runs <code>toil dossiers onboard</code>, which on a terminal asks for each missing connection itself.
      </p>
      <form className="change" aria-labelledby="repo-setup-form" onSubmit={submit} noValidate>
        <h3 id="repo-setup-form">Check a repository</h3>
        <TextField label="Repository folder" value={cwd} onChange={setCwd} hint="A folder in the clone. Left empty, the folder Toil UI was started in." />
        <TextField label="Dossier" value={dossier} onChange={setDossier} hint="Left empty, the one the folder resolves to." />
        <p className="runs">
          Runs <code>{commandLine('dossiers onboard', args)}</code>, which reads your config and dossiers and sends one test read per connection. It changes nothing.
        </p>
        <div className="change-actions">
          <button type="submit" className="btn btn--accent" disabled={busy} aria-busy={busy || undefined}>
            {busy ? 'Checking…' : 'Check this repo'}
          </button>
        </div>
      </form>
      {result && !result.ok && <OutcomeLine outcome={{ ok: false, message: result.message, fix: result.fix }} />}
      {result?.ok && <Plan loadedPlan={result} areas={areas} config={config} rerun={run} onChanged={onChanged} />}
    </Card>
  );
}

function Plan({ loadedPlan, areas, config, rerun, onChanged }: { loadedPlan: Extract<Loaded, { ok: true }>; areas: AreaInfo[]; config: ConfigApi; rerun: (extra?: Record<string, unknown>) => Promise<Loaded>; onChanged: () => Promise<void> }) {
  const { plan, warnings } = loadedPlan;
  const ready = plan.areas.filter((a) => a.connection !== null && a.test?.ok).length;
  const summary: Outcome = plan.ok
    ? { ok: true, message: `${plan.dossier.name} is set up: every area has a connection and read successfully.`, warnings }
    : { ok: false, message: `${plan.dossier.name}: ${ready} of ${plan.areas.length} area${plan.areas.length === 1 ? '' : 's'} ready.`, fix: plan.check.ok ? null : 'dossiers check found problems, listed below.' };
  const missing = plan.areas.filter((a) => a.status === 'missing');
  const ambiguous = plan.areas.filter((a) => a.status === 'ambiguous');
  return (
    <Stack gap="sm" className="shown">
      <p className="note">
        <Path value={plan.dossier.file} what={`${plan.dossier.name}'s file path`} /> ({plan.dossier.source})
        {plan.ownCopy && (
          <>
            ; your own copy, <Path value={plan.ownCopy} what="your copy's file path" />, applies
          </>
        )}
      </p>
      <OutcomeLine outcome={summary} />
      <DataTable
        label={`What ${plan.dossier.name}'s areas use`}
        caption={`What ${plan.dossier.name}'s areas use`}
        rows={plan.areas}
        rowKey={(a) => a.path}
        columns={[
          { header: 'Area', label: 'Area', rowHeader: true, cell: (a) => a.path },
          { header: 'Selects', label: 'Selects', cell: (a) => <span className="any-break">{selectsText(a.selects)}</span> },
          { header: 'Status', label: 'Status', cell: (a) => <span className={a.status === 'missing' || a.status === 'ambiguous' ? 'failure' : undefined}>{STATUS[a.status]}</span> },
          { header: 'Connection', label: 'Connection', cell: (a) => a.connection ?? (a.candidates ? a.candidates.join(', ') : '–') },
          {
            header: 'Test read',
            label: 'Test read',
            cell: (a) => (a.test === null ? '–' : a.test.ok ? <span className="any-break">{a.test.request ?? 'settings and secret only'}</span> : <span className="failure">{a.test.error?.message}</span>),
          },
        ]}
      />
      {plan.check.problems.length > 0 && (
        <>
          <h4 className="shown-repos">dossiers check</h4>
          <ul className="plain">
            {plan.check.problems.map((p, i) => (
              <li key={i} className={p.level === 'error' ? 'failure' : 'note'}>
                {p.level}: <code>{p.path}</code> {p.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {missing.map((a) => {
        const host = 'host' in a.selects ? a.selects.host : undefined;
        return (
          <NewConnectionForm
            key={a.path}
            areas={areas}
            config={config}
            area={a.area}
            title={`Add a ${a.area} connection${host ? ` on ${host}` : ''}`}
            suggest={{ ...(a.suggest?.name ? { name: a.suggest.name } : {}), ...(a.suggest?.baseUrl ? { values: { baseUrl: a.suggest.baseUrl } } : {}) }}
            onAdded={async () => {
              await rerun();
              await onChanged();
            }}
          />
        );
      })}
      {ambiguous.map((a) => (
        <PinForm key={a.path} area={a} dossier={plan.dossier.name} config={config} pin={(connection) => rerun({ pin: [`${a.area}=${connection}`] })} />
      ))}
    </Stack>
  );
}

function PinForm({ area: a, dossier, config, pin }: { area: OnboardArea; dossier: string; config: ConfigApi; pin: (connection: string) => Promise<Loaded> }) {
  const candidates = a.candidates ?? [];
  const [choice, setChoice] = useState(candidates[0] ?? '');
  return (
    <ChangeForm
      title={`Pick the ${a.area} connection for ${dossier}`}
      explain={`Several of your ${a.area} connections fit ${a.path}. The one you pick is pinned in your own copy of ${dossier} (~/.toil/dossiers), which then applies wherever the shared one does. Your copy is yours, so writes may follow its bindings.`}
      runs={commandLine('dossiers onboard', [dossier, '--plan', '--pin', `${a.area}=${choice || '<connection>'}`])}
      submit="Pin it"
      disabled={config.disabled}
      onSubmit={async () => {
        const after = await pin(choice);
        return after.ok ? { ok: true, message: `${choice} is pinned for ${a.area}.`, warnings: after.warnings } : { ok: false, message: after.message, fix: after.fix };
      }}
    >
      <SelectField label="Connection" value={choice} onChange={setChoice} options={candidates.map((c) => ({ value: c, label: c }))} />
    </ChangeForm>
  );
}
