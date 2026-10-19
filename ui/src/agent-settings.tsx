/**
 * The agent's settings, in the Settings view (#251): which adapter answers
 * (Claude, GitHub Copilot or Codex, or none), the model, the CLI's path and,
 * for Claude, the endpoint (the Anthropic API, Bedrock, Foundry or Vertex).
 * For each adapter it says whether its SDK is installed beside Toil UI and
 * which CLI it would start, or why it can't. The server keeps the choice in
 * `~/.toil-ui/agent.json`, never in toil's config, and there is no field for
 * a key: each SDK signs in the way its own CLI does. A form with one blank
 * left deliberately out.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Label, Radio, RadioGroup, TextField } from 'react-aria-components';
import type { AdapterStatus, AgentSettings, AgentSettingsClient, AgentStatus } from './server-client.ts';

const ENDPOINT_LABEL: Record<string, string> = { anthropic: 'Anthropic API', bedrock: 'Amazon Bedrock', foundry: 'Microsoft Foundry', vertex: 'Google Vertex AI' };

function adapterLine(a: AdapterStatus): string {
  const sdk = a.installed ? `${a.package} is installed` : `${a.package} isn't installed`;
  const cli = a.cli.path ? `it would start ${a.cli.path}` : (a.cli.problem ?? 'its CLI was not found');
  return `${sdk}; ${cli}`;
}

export interface AgentSettingsPanelProps {
  client: AgentSettingsClient;
  /** The choice was saved: the pane's starters and answers come from it from now on. */
  onChange?: (status: AgentStatus) => void;
}

export function AgentSettingsPanel({ client, onChange }: AgentSettingsPanelProps) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [form, setForm] = useState<AgentSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    client.status().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        setForm(s.settings);
      },
      (e: unknown) => live && setProblem(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [client]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setSaved('');
    try {
      const next = await client.save({ ...form, endpoint: form.adapter === 'claude' ? form.endpoint : null });
      setStatus(next);
      setForm(next.settings);
      setProblem(null);
      setSaved(next.settings.adapter === 'none' ? 'Saved: no agent answers.' : `Saved: ${next.adapters.find((a) => a.name === next.settings.adapter)?.label ?? next.settings.adapter} answers from the next question.`);
      onChange?.(next);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const none = status?.adapters.every((a) => !a.installed);
  return (
    <section className="panel" aria-labelledby="agent-settings">
      <h2 id="agent-settings">Agent</h2>
      <p className="note">
        The agent reasons with the subscription you already have, through its own CLI on this machine. Toil UI never downloads one, stores no keys, and gives the agent read-only tools: anything it suggests changing comes back as a proposal for you to apply.
      </p>
      {status?.problem && <p className="failure">{status.problem}</p>}
      {problem && (
        <p role="alert" className="failure">
          {problem}
        </p>
      )}
      {!status || !form ? (
        !problem && <p className="note">Reading the agent settings…</p>
      ) : (
        <form className="agent-form" onSubmit={submit}>
          {none && (
            <p className="failure">
              None of the three agent SDKs is installed beside Toil UI: {status.adapters.map((a) => `${a.label} (${a.package})`).join(', ')}. Install the one your organization approves, with its CLI on PATH, and choose it here.
            </p>
          )}
          <RadioGroup className="agent-adapters" value={form.adapter} onChange={(v) => setForm({ ...form, adapter: v as AgentSettings['adapter'] })}>
            <Label>Adapter</Label>
            <Radio value="none" className="agent-choice">
              <strong>None</strong>
              <span className="note">The dashboards only; questions get no answer.</span>
            </Radio>
            {status.adapters.map((a) => (
              <Radio key={a.name} value={a.name} className="agent-choice">
                <strong>{a.label}</strong>
                <span className={a.installed && a.cli.path ? 'note' : 'agent-missing'}>{adapterLine(a)}.</span>
              </Radio>
            ))}
          </RadioGroup>
          {form.adapter !== 'none' && (
            <>
              <TextField className="field-text" value={form.model ?? ''} onChange={(v) => setForm({ ...form, model: v || null })}>
                <Label>Model (empty for the CLI's default)</Label>
                <Input spellCheck={false} autoComplete="off" />
              </TextField>
              <TextField className="field-text" value={form.cliPath ?? ''} onChange={(v) => setForm({ ...form, cliPath: v || null })}>
                <Label>CLI path (empty to use the one on PATH)</Label>
                <Input spellCheck={false} autoComplete="off" />
              </TextField>
            </>
          )}
          {form.adapter === 'claude' && (
            <RadioGroup className="shells" orientation="horizontal" value={form.endpoint ?? ''} onChange={(v) => setForm({ ...form, endpoint: (v || null) as AgentSettings['endpoint'] })}>
              <Label className="agent-label">Endpoint</Label>
              <Radio value="" className="shell-choice">
                Claude Code's default
              </Radio>
              {(status.adapters.find((a) => a.name === 'claude')?.endpoints ?? []).map((e) => (
                <Radio key={e} value={e} className="shell-choice">
                  {ENDPOINT_LABEL[e] ?? e}
                </Radio>
              ))}
            </RadioGroup>
          )}
          {form.adapter === 'claude' && form.endpoint && form.endpoint !== 'anthropic' && (
            <p className="note">Claude Code reads that cloud's own region and credentials from its environment, as it does on its own; Toil UI sets only the switch.</p>
          )}
          <div className="proposal-actions">
            <Button type="submit" className="btn btn--accent" isDisabled={busy}>
              Save
            </Button>
            <span className="note" role="status">
              {saved}
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

/** What the preview shows instead: what the local app lets you choose, changing nothing. */
export function AgentSettingsPreview() {
  return (
    <section className="panel" aria-labelledby="agent-settings">
      <h2 id="agent-settings">Agent</h2>
      <p className="note">
        The preview answers with a scripted agent. The local app answers with the one your organization approved: Claude (the Claude Agent SDK, on the Anthropic API, Bedrock, Foundry or Vertex), GitHub Copilot (the Copilot SDK) or Codex (the Codex SDK), each through its own CLI on your machine. You choose the adapter, model and CLI path here; no key is ever stored.
      </p>
    </section>
  );
}
