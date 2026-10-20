/**
 * Settings, Agent's adapter status and one-press install (#344). For each
 * adapter: whether its SDK is installed and at which version against the one
 * Toil UI was tested with, which CLI it would start or why it can't, and what
 * else is worth knowing (an npm shim resolved, a bundled CLI npm skipped).
 * A missing SDK gets Install, which opens a dialog showing the one npm
 * command it will run, word for word, before anything runs; npm's output
 * streams into the dialog, and the SDK is loaded afterwards to prove it.
 * Beside it, Copy command, for a machine where Toil UI may not run npm or a
 * person who'd rather run it themselves. Where Toil UI can't install (npx's
 * cache, a layout it doesn't recognise) the dialog says why and offers the
 * copy only. A requisition desk that shows you the form before it stamps it.
 */

import { useRef, useState } from 'react';
import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { AdapterStatus, AgentSettingsClient, InstallPlan } from './server-client.ts';
import { Card } from './components/layout.tsx';

/** What the preview's Install shows instead of running anything. */
export const INSTALL_PREVIEW = 'This is the preview, so nothing is installed. Toil UI on your own machine runs this command when you press Install.';

function statusLines(a: AdapterStatus): string[] {
  const sdk = a.installed ? `${a.package} ${a.version ?? ''} is installed beside Toil UI`.replace('  ', ' ') : `${a.package} isn't installed beside Toil UI; Toil UI was tested with ${a.tested}`;
  const cli = a.cli.path ? `It would start ${a.cli.path}` : `${a.cli.problem ?? 'Its CLI was not found.'}${a.cli.fix ? ` ${a.cli.fix}` : ''}`;
  return [`${sdk}.`, cli.endsWith('.') ? cli : `${cli}.`, ...a.notes];
}

export function AdaptersCard({ adapters, client, onInstalled }: { adapters: AdapterStatus[]; client: Pick<AgentSettingsClient, 'install'> | null; onInstalled?: (a: AdapterStatus) => void }) {
  const [installing, setInstalling] = useState<AdapterStatus | null>(null);
  return (
    <Card as="section" className="panel" aria-labelledby="agent-adapters">
      <h2 id="agent-adapters">Adapters on this machine</h2>
      <p className="note">Each adapter needs its SDK beside Toil UI and its own CLI on this machine. Install runs one npm command, shown to you first, at the version Toil UI was tested with.</p>
      <ul className="adapter-status">
        {adapters.map((a) => {
          const ready = a.installed && a.cli.path !== null;
          return (
            <li key={a.name} className="adapter-status__row" data-adapter={a.name}>
              <div className="adapter-status__head">
                <strong>{a.label}</strong>
                <span className={ready ? 'agent-pick__ready' : 'agent-missing'}>{ready ? 'Ready' : a.installed ? 'Needs a fix' : 'Not installed'}</span>
              </div>
              {statusLines(a).map((line, i) => (
                <p key={i} className={i === 1 && !a.cli.path ? 'agent-missing' : 'note'}>
                  {line}
                </p>
              ))}
              {!a.installed && (
                <div className="proposal-actions">
                  <Button className="btn btn--accent" onPress={() => setInstalling(a)} data-install={a.name}>
                    Install {a.label}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {installing && (
        <InstallDialog
          adapter={installing}
          plan={installing.install}
          client={client}
          onClose={() => setInstalling(null)}
          onInstalled={(next) => {
            onInstalled?.(next);
          }}
        />
      )}
    </Card>
  );
}

/**
 * The Install dialog: the exact command, then Install (when Toil UI can run
 * it here) or Copy command, and npm's output as it arrives. Nothing runs
 * until Install is pressed, and what runs is what the dialog shows: the
 * server refuses a command that no longer matches its own.
 */
export function InstallDialog({ adapter, plan, client, onClose, onInstalled }: { adapter: AdapterStatus; plan: InstallPlan; client: Pick<AgentSettingsClient, 'install'> | null; onClose: () => void; onInstalled: (a: AdapterStatus) => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<'ready' | 'running' | 'done' | 'failed'>('ready');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState('');
  const abort = useRef<AbortController | null>(null);
  const runnable = plan.argv !== null && client !== null;

  const install = async () => {
    if (!client) return;
    setState('running');
    setLines([]);
    setMessage('');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const next = await client.install(adapter.name, plan.command, (line) => setLines((ls) => [...ls.slice(-400), line]), controller.signal);
      setState('done');
      setMessage(`Installed ${adapter.package} ${next.version ?? ''}, and Toil UI loaded it.${next.cli.path ? ` ${adapter.label} is ready.` : ` ${next.cli.problem ?? ''} ${next.cli.fix ?? ''}`}`.replace(/\s+/g, ' ').trim());
      onInstalled(next);
    } catch (e) {
      setState('failed');
      setMessage(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plan.command);
      setCopied('Copied the command.');
    } catch {
      setCopied('Copying was refused here; select the command above and copy it yourself.');
    }
  };

  return (
    <ModalOverlay className="feedback-overlay" data-backdrop="" isDismissable={state !== 'running'} isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal className="feedback-modal">
        <Dialog className="feedback-dialog" aria-labelledby="install-title">
          <div className="feedback-body">
            <Heading slot="title" id="install-title">
              Install {adapter.label}'s SDK
            </Heading>
            <p>
              Toil UI runs this one command, through the npm that came with your Node and with your own npm config, so your organization's registry and proxy apply. It installs {adapter.package} {adapter.tested}, the version Toil UI was tested with, beside Toil UI, runs no install scripts, and takes nothing published in the last 14 days.
            </p>
            <pre className="install-command" data-scroller="" tabIndex={0} role="region" aria-label="The command">
              {plan.command}
            </pre>
            {plan.folder && <p className="note">It installs into {plan.folder}.</p>}
            {plan.problem && (
              <p className="failure">
                {plan.problem} {plan.fix}
              </p>
            )}
            {!client && <p className="config-off">{INSTALL_PREVIEW}</p>}
            {lines.length > 0 && (
              <pre className="install-output" data-scroller="" tabIndex={0} role="log" aria-label="npm's output">
                {lines.join('\n')}
              </pre>
            )}
            {message && (
              <p role={state === 'failed' ? 'alert' : 'status'} className={state === 'failed' ? 'failure' : 'note'}>
                {message}
              </p>
            )}
            <div className="proposal-actions">
              {state !== 'done' && (
                <Button className="btn btn--accent" onPress={() => void install()} isDisabled={!runnable || state === 'running'} data-install-run="">
                  {state === 'running' ? 'Installing…' : state === 'failed' ? 'Try again' : 'Install'}
                </Button>
              )}
              <Button className="btn" onPress={() => void copy()} data-install-copy="">
                Copy command
              </Button>
              {state === 'running' ? (
                <Button className="btn" onPress={() => abort.current?.abort()}>
                  Stop
                </Button>
              ) : (
                <Button className="btn" slot="close">
                  {state === 'done' ? 'Done' : 'Cancel'}
                </Button>
              )}
              <span className="note" role="status">
                {copied}
              </span>
            </div>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
