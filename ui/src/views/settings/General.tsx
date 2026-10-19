/**
 * Bounds and the time limit (#253, item 4). toil has no command that changes
 * either, and Toil UI doesn't edit toil's files, so this page shows them
 * read-only, with where each is set. The file workspace bound is the one a
 * config file can relax (docs/bounds.md), and toil says so on every envelope
 * when it is relaxed, which is how this page knows; the time limit is
 * TOIL_TIMEOUT_MS in the environment toil runs in, which here is the server's.
 */

import { useEffect, useState } from 'react';
import type { ConfigApi, SettingsInfo } from '../../config.ts';
import { Card, Path } from '../../components/layout.tsx';

const seconds = (ms: number) => (ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`);

export function General({ config }: { config: ConfigApi }) {
  const [file, setFile] = useState<string | null>(null);
  const [relaxed, setRelaxed] = useState<string | null>(null);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    config.run('connections list', {}).then(
      (e) => {
        if (!e.ok) return setFailed(e.error.message);
        setFile((e.data as { configFile: string }).configFile);
        setRelaxed(e.meta.warnings?.find((w) => w.code === 'BOUND_RELAXED')?.message ?? null);
      },
      (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
    );
    config.settings().then(setSettings, (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)));
  }, [config]);

  if (failed) {
    return (
      <div role="alert" className="failure">
        <p>The settings didn't load: {failed}</p>
      </div>
    );
  }
  if (!file || !settings) return <p className="skin-loading">Reading toil's settings…</p>;
  const t = settings.timeout;
  return (
    <>
      <p className="lede">toil has no command to change these, and Toil UI never edits toil's files, so they're shown as toil reports them, with where each is set.</p>
      <Card as="section" className="panel" aria-labelledby="bounds">
        <h2 id="bounds">Bounds</h2>
        <dl className="fields">
          <dt>The file workspace</dt>
          <dd>{relaxed ? 'Relaxed: commands may read and write files anywhere you can, except toil\'s own files.' : 'Held: commands read and write files only inside the workspace.'}</dd>
          <dt>Set in</dt>
          <dd>
            <Path value={file} what="config file path" />, as <code>"bounds": {'{'} "files": "unbounded" {'}'}</code>
          </dd>
        </dl>
        {relaxed && <p className="note">toil says: {relaxed}</p>}
        <p className="note">Only that file can relax a bound, and only this one: no env var, flag, dossier or repository file can. Every other bound always holds.</p>
      </Card>
      <Card as="section" className="panel" aria-labelledby="timeout">
        <h2 id="timeout">Time limit</h2>
        <dl className="fields">
          <dt>Each command stops after</dt>
          <dd>
            {seconds(t.effectiveMs)}
            {t.effectiveMs === t.defaultMs ? ", toil's default" : ''}
          </dd>
          <dt>Set by</dt>
          <dd>
            <code>{t.variable}</code>
            {t.value === null ? ', which is not set' : `=${t.value}`}, in the environment <code>toil-ui</code> was started from
          </dd>
        </dl>
        <p className="note">
          Without the variable, a command that declares a longer limit (a scan, a report) gets its own. <code>toil wait</code> has its own <code>--timeout</code>, capped by <code>"wait": {'{'} "maxTimeout" {'}'}</code> in <code>{file}</code>. To change the limit, set {t.variable} and start <code>toil-ui</code> again.
        </p>
      </Card>
    </>
  );
}
