/**
 * The agent last used for each dossier's Analyze (#494). Toil UI's own state,
 * so it lives in its data folder (`~/.toil-ui/dossier-agents.json`) beside the
 * global default in `agent.json`, never in toil's dossier file and never in
 * the browser: a second browser, or a restart, sees the same memory. The file
 * holds an adapter's name per dossier name and nothing else, so it has no
 * room for a key. A stale entry (a dossier renamed or removed behind Toil
 * UI's back) is only ever a name nobody asks for. A seating chart for
 * software that was told to sit wherever it sat last time.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';
import type { AdapterName } from './runtime.ts';

const NAMES: readonly string[] = ['claude', 'copilot', 'codex'];
/** toil's dossier names (the same rule the server checks a rename with). */
const DOSSIER = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const MAX_DOSSIER = 200;

export const dossierAgentsFile = (dataDir: string) => nodePath.join(dataDir, 'dossier-agents.json');

export class DossierAgents {
  private agents: Map<string, AdapterName>;

  constructor(private readonly dataDir: string) {
    this.agents = readAgents(dossierAgentsFile(dataDir));
  }

  /** The adapter last used for the dossier, or null. */
  get(dossier: string): AdapterName | null {
    return this.agents.get(dossier) ?? null;
  }

  /** Remembers an adapter for a dossier; a name that is not an adapter or a dossier is ignored. */
  set(dossier: string, adapter: string): boolean {
    if (!valid(dossier) || !NAMES.includes(adapter)) return false;
    if (this.agents.get(dossier) === adapter) return true;
    this.agents.set(dossier, adapter as AdapterName);
    this.save();
    return true;
  }

  /** A dossier toil renamed: its memory moves to the new name, replacing any left under it. */
  rename(from: string, to: string) {
    if (from === to || !valid(to)) return;
    const adapter = this.agents.get(from);
    const had = this.agents.delete(to);
    if (adapter === undefined) {
      if (had) this.save();
      return;
    }
    this.agents.delete(from);
    this.agents.set(to, adapter);
    this.save();
  }

  /** A dossier toil no longer has. */
  forget(dossier: string) {
    if (this.agents.delete(dossier)) this.save();
  }

  /** Writes owner-only through a temporary file, so a crash never leaves half of one. */
  private save() {
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const file = dossierAgentsFile(this.dataDir);
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, agents: Object.fromEntries(this.agents) }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, file);
  }
}

const valid = (dossier: string) => dossier.length <= MAX_DOSSIER && DOSSIER.test(dossier);

/** What the file holds, entry by entry; a missing or broken file is no memory, never a failed start. */
function readAgents(file: string): Map<string, AdapterName> {
  const out = new Map<string, AdapterName>();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { agents?: unknown };
    if (typeof parsed.agents !== 'object' || parsed.agents === null || Array.isArray(parsed.agents)) return out;
    for (const [dossier, adapter] of Object.entries(parsed.agents)) if (valid(dossier) && typeof adapter === 'string' && NAMES.includes(adapter)) out.set(dossier, adapter as AdapterName);
  } catch {
    // Nothing remembered yet, or a file that is not JSON: the global default answers.
  }
  return out;
}
