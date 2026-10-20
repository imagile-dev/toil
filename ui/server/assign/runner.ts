/**
 * The runner behind Toil UI's assignments (#293): one agent run per
 * assignment, through the AgentHost's `task()`, so every run goes through
 * the same SDK loading, environment allowlist, usage ledger and caps as a
 * question in the Ask pane (#295). Per mode:
 *
 * - **refine** and **investigate** get the dossier's read-only tools (the
 *   cache's owi_* and pr_* tools, toil's live reads, proposal_fields) and no
 *   shell, no file writes. The finished text goes through answer.ts's
 *   checks: every id held to the tools' results, every proposal to toil's
 *   registry. Investigate's report becomes a "post as a comment" proposal.
 * - **implement** runs on Codex alone, the one adapter whose own sandbox
 *   holds commands and writes to one folder with no network on every OS
 *   Toil UI supports. The folder is under the cache. The agent clones the
 *   dossier's repository there from its local path, branches, changes and
 *   stages; Toil UI then reads the branch from `.git/HEAD` and the staged
 *   diff through toil's own read-only `git status` and `git diff`, and
 *   proposes the commit and push as git lines for a person to run, since
 *   toil has no command that pushes.
 *
 * Every tool call is in the transcript, and every call toil makes for the
 * run is in toil's audit log as `caller: "toil-ui"` with the assignment as
 * its `actor`. A runner's brief, stamped, with the carbon copy filed first.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ADAPTER_NAME, actorOf, branchName, type AdapterChoice, type AssignAdapter, type Branch, type RepoChoice } from '../../src/assign/model.ts';
import { RunStopped, type RunContext, type RunResult, type Runner } from '../../src/assign/queue.ts';
import type { Proposal } from '../../src/proposal.ts';
import type { Envelope, Execute, WorkItem } from '../../src/toil.ts';
import { finish, writeCommands, type WriteCommand } from '../agents/answer.ts';
import { AgentError } from '../agents/cli.ts';
import type { AgentHost } from '../agents/host.ts';
import type { Workspace } from '../agents/runtime.ts';
import { cacheTools, Ledger, liveTools, proposalTool, prTools, recorded, type AgentData, type MapIds, type ReadCommand, type ToolSpec } from '../agents/tools.ts';
import { CALLER } from '../store.ts';
import { implementPrompt, readPrompt, splitLines } from './prompts.ts';

export interface HostRunnerOptions {
  host: Pick<AgentHost, 'task' | 'adapterChoices' | 'chosen'>;
  dataDir: string;
  registry: readonly ReadCommand[];
  execute: Execute;
  mapIds: MapIds;
  data(dossier: string): AgentData | null;
  version: string;
  toilVersion: string;
  now?: () => string;
}

/** The largest staged diff an assignment keeps, in characters. */
export const MAX_DIFF = 200_000;

export const sha256 = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex');

/** The folder implement mode clones into, under the cache so a wipe takes it. */
export const workFolder = (dataDir: string, id: string) => join(dataDir, 'cache', 'work', id);

/** The tracker command that posts a comment on an item, by area, where toil has one; its input from the item and the text. */
const COMMENT: Record<string, (key: string, body: string) => { command: string; input: Record<string, unknown> }> = {
  'ado-cloud': (key, body) => ({ command: 'ado-cloud work-item comment', input: { id: Number(key), body } }),
  ado: (key, body) => ({ command: 'ado work-item comment', input: { id: key, body } }),
  jira: (key, body) => ({ command: 'jira issue comment', input: { key, body } }),
  'jira-cloud': (key, body) => ({ command: 'jira-cloud issue comment', input: { key, body } }),
};

/** A report as one comment: its paragraphs, citations written as the ids they name. */
export const commentText = (parts: Array<{ text: string }>, by: string) => `${parts.map((p) => p.text.replace(/\[\[([^\]]+)\]\]/g, '$1')).join('\n\n')}\n\nInvestigated by ${by} through Toil UI, and posted by a person who reviewed it.`;

/** The proposal that posts an investigation's report on the item, or one that says toil can't. */
export function commentProposal(dossier: string, item: WorkItem, body: string, writes: ReadonlyMap<string, WriteCommand>): Proposal {
  const make = COMMENT[item.source.area];
  const made = make ? make(item.source.key, body) : null;
  const known = made && writes.has(made.command) ? made : null;
  return {
    id: `agent:${item.id}:comment:report`,
    from: 'agent',
    item: item.id,
    title: `Post the report as a comment on ${item.source.key}`,
    reason: 'The investigation above, as one comment, so the people on the item can read it where they work.',
    command: known?.command ?? null,
    // The dossier goes with it, as answer.ts adds it to the agent's own proposals, so toil resolves the same connection and project.
    input: known ? (writes.get(known.command)!.fields.has('dossier') ? { dossier, ...known.input } : known.input) : null,
    note: known ? 'The comment is the report exactly as shown above.' : `toil has no command that comments on a ${item.source.area} item, so copy the report into the item by hand.`,
  };
}

/** What `.git/HEAD` names in a clone: the branch, or null for a detached HEAD or no clone. */
export function headBranch(folder: string): string | null {
  try {
    const head = readFileSync(join(folder, '.git', 'HEAD'), 'utf8').trim();
    const m = /^ref: refs\/heads\/(.+)$/.exec(head);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

const slashes = (p: string) => p.replace(/\\/g, '/');

export function hostRunner(o: HostRunnerOptions): Runner {
  const writes = writeCommands(o.registry);
  const now = o.now ?? (() => new Date().toISOString());
  const read = (command: string, input: Record<string, unknown>, extra: { workspace?: string; actor: string }) =>
    o.execute(command, input, { readOnly: true, caller: CALLER, ...extra });

  /** Wraps each tool so its calls are in the transcript, with the assignment's actor on toil's calls. */
  const traced = (tools: ToolSpec[], ctx: RunContext): ToolSpec[] =>
    tools.map((t) => ({
      ...t,
      run: async (input, signal) => {
        const result = await t.run(input, signal);
        const failed = typeof result === 'object' && result !== null && 'error' in result;
        ctx.record({ kind: 'tool', title: `${failed ? 'Tool failed' : 'Called'}: ${t.name}`, detail: `${JSON.stringify(input)}${failed ? `\n${String((result as { error: unknown }).error)}` : ''}` });
        return result;
      },
    }));

  return {
    adapters(): AdapterChoice[] {
      return o.host.adapterChoices().map((a) => ({
        name: a.name,
        label: a.label,
        problem: a.problem,
        implement: a.workspace ? null : `${ADAPTER_NAME[a.name]} can't take implement mode through Toil UI yet: only Codex's own sandbox holds an agent's commands and writes to one folder, with no network, on Windows, macOS and Linux alike.`,
      }));
    },
    preferred: () => o.host.chosen,
    async run(ctx): Promise<RunResult> {
      const { assignment: a, item } = ctx;
      const adapter = a.adapter as AssignAdapter;
      const data = o.data(a.dossier);
      if (!data) throw new RunStopped('error', `Toil UI hasn't synced ${a.dossier}, so the agent has nothing to read.`, 'Press Sync now in the Sync panel, then assign again.');
      const actor = actorOf(a.id);
      // toil's live reads for this run carry the assignment as their actor in the audit log.
      const execute: Execute = (command, input, options) => o.execute(command, input, { ...options, actor });
      const ledger = new Ledger();
      const tools = traced(recorded([...cacheTools(a.dossier, data, ledger), ...prTools(a.dossier, data, ledger), proposalTool(o.registry), ...liveTools(a.dossier, o.registry, execute, o.mapIds, ledger)], ledger), ctx);

      let workspace: Workspace | null = null;
      let branch: string | null = null;
      let repo: RepoChoice | null = null;
      let modePrompt;
      if (a.mode === 'implement') {
        repo = await repoNamed(o.execute, a.dossier, a.repo);
        branch = branchName(item);
        const folder = workFolder(o.dataDir, a.id);
        rmSync(folder, { recursive: true, force: true });
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        workspace = { root: folder };
        modePrompt = implementPrompt(a.dossier, item, now(), { repo: repo.name, source: repo.path, branch });
      } else {
        modePrompt = readPrompt(a.mode, a.dossier, item, now());
      }
      const shown = await read('dossiers show', { dossier: a.dossier }, { actor });
      const startedOn = {
        at: now(),
        toil: o.toilVersion,
        toilUi: o.version,
        adapter,
        model: null as string | null,
        // Toil UI hands an assigned agent no skill: its tools and this prompt are all it gets.
        skills: [] as string[],
        tools: tools.map((t) => t.name),
        dossier: { name: a.dossier, fingerprint: shown.ok ? sha256(shown.data) : null },
        item: { id: item.id, updated: item.updated, fingerprint: sha256(item) },
        prompt: sha256(`${modePrompt.system}\n\n${modePrompt.prompt}`),
      };
      ctx.record({ kind: 'prompt', title: 'System prompt', detail: modePrompt.system });
      ctx.record({ kind: 'prompt', title: 'Task', detail: modePrompt.prompt });

      let text: string;
      let usage;
      try {
        const done = await o.host.task({
          adapter,
          dossier: a.dossier,
          chat: a.id,
          system: modePrompt.system,
          prompt: modePrompt.prompt,
          tools,
          workspace,
          signal: ctx.signal,
          onText: () => undefined,
          onActivity: (act) => ctx.record({ kind: 'activity', title: act.title, ...(act.detail ? { detail: act.detail } : {}) }),
        });
        text = done.text;
        usage = done.usage;
        startedOn.model = done.model;
      } catch (e) {
        if (e instanceof AgentError) throw new RunStopped(e.capped ? 'usage' : 'error', e.message, e.fix, e.usage ?? null);
        throw e;
      }
      ctx.record({ kind: 'text', title: 'The agent answered', detail: text });

      const lines = splitLines(text);
      const by = ADAPTER_NAME[adapter];
      const answer = finish(lines.text, { dossier: a.dossier, prompt: a.mode, by, ledger, writes });
      const report = { parts: answer.parts, citations: answer.citations, unverified: answer.unverified ?? [], warnings: answer.warnings ?? [] };
      const proposals = [...answer.proposals];
      if (a.mode === 'investigate' && report.parts.length && !lines.injection) proposals.push(commentProposal(a.dossier, item, commentText(report.parts, by), writes));

      let branchInfo: Branch | null = null;
      if (workspace && branch && repo) {
        branchInfo = await branchOf(read, workspace.root, branch, repo.name, actor);
        if (!branchInfo.onBranch) report.warnings.unshift(`The clone isn't on ${branch}, the branch the agent was asked to make, so check its work before you use it.`);
        if (branchInfo.files.length) proposals.unshift(pushProposal(item, branchInfo));
      }
      return { report, proposals, questions: lines.questions, injection: lines.injection, usage, startedOn, branch: branchInfo };
    },
  };
}

/** The dossier's repositories that have a local path: what implement mode can clone. */
export async function reposOf(execute: Execute, dossier: string): Promise<RepoChoice[]> {
  const e = await execute('dossiers show', { dossier }, { readOnly: true, caller: CALLER });
  if (!e.ok) return [];
  const repos = ((e.data as { dossier?: { repos?: unknown } } | null)?.dossier?.repos ?? []) as Array<{ name?: unknown; path?: unknown }>;
  return (Array.isArray(repos) ? repos : []).flatMap((r) => (typeof r.name === 'string' && typeof r.path === 'string' && r.path ? [{ name: r.name, path: r.path }] : []));
}

async function repoNamed(execute: Execute, dossier: string, name: string | null): Promise<RepoChoice> {
  const repos = await reposOf(execute, dossier);
  const hit = repos.find((r) => r.name === name) ?? (name === null && repos.length === 1 ? repos[0] : undefined);
  if (!hit) throw new RunStopped('error', `${dossier} has no repository ${name ?? ''} with a local path any more.`, `Check toil dossiers show ${dossier}, then assign again.`);
  return hit;
}

/** The clone's branch, its changed files and its staged diff, through toil's own read-only git commands. */
async function branchOf(read: (command: string, input: Record<string, unknown>, extra: { workspace?: string; actor: string }) => Promise<Envelope>, folder: string, name: string, repo: string, actor: string): Promise<Branch> {
  const status = await read('git status', {}, { workspace: folder, actor });
  const diff = await read('git diff', { staged: true }, { workspace: folder, actor });
  const files = status.ok ? filesOf(status.data) : [];
  let text: string | null = null;
  if (diff.ok) {
    const raw = typeof diff.data === 'string' ? diff.data : JSON.stringify(diff.data, null, 2);
    text = raw.length > MAX_DIFF ? `${raw.slice(0, MAX_DIFF)}\n[cut at ${MAX_DIFF} characters]` : raw;
  }
  return { name, repo, folder: slashes(folder), onBranch: headBranch(folder) === name, files, diff: text };
}

/** `git status`'s files, whatever shape the toil in use reports them in. */
function filesOf(data: unknown): Branch['files'] {
  const d = (data ?? {}) as Record<string, unknown>;
  const out: Branch['files'] = [];
  for (const [status, list] of Object.entries(d)) {
    if (!Array.isArray(list)) continue;
    for (const f of list) {
      if (typeof f === 'string') out.push({ path: f, status });
      else if (f && typeof f === 'object' && typeof (f as { path?: unknown }).path === 'string') out.push({ path: (f as { path: string }).path, status: String((f as { status?: unknown }).status ?? status) });
    }
  }
  return out;
}

/** Commit and push are a person's: toil has no command for either, so the proposal is the exact git lines. */
export function pushProposal(item: WorkItem, b: Branch): Proposal {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  return {
    id: `agent:${item.id}:push:${b.name}`,
    from: 'agent',
    item: item.id,
    title: `Commit and push ${b.name}`,
    reason: `The agent staged ${b.files.length === 1 ? 'one file' : `${b.files.length} files`} on ${b.name} in a clone of ${b.repo}. Review the staged diff, then commit and push it yourself.`,
    command: null,
    input: null,
    note: `toil has no command that commits or pushes, so run these in a terminal once the diff looks right: git -C ${q(b.folder)} commit -m ${q(`${item.source.key}: ${item.title}`)} then git -C ${q(b.folder)} push origin ${b.name}. The clone's origin is your local clone of ${b.repo}, so the branch lands there first; push it on from there.`,
  };
}
