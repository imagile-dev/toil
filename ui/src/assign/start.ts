/**
 * The Command Center's "start every ready item" (#307), on the assignment
 * queue (#293). A ready item is one an agent can pick up, so each one in the
 * plan is assigned in implement mode, in the order it was slated, on the
 * adapter chosen in Settings when it can implement, else on the first one
 * that can, in the dossier's one repository with a local path. The queue
 * runs them as its limits allow; an item that already has an implement
 * assignment queued or working is left alone. Anything that stops the plan
 * before it starts (no adapter that can implement, no repository, or two to
 * choose between) is an error that says so, and nothing is queued. One
 * stamp, many forms, all in triplicate.
 */

import type { StartReady } from '../data.ts';
import type { AssignmentsApi } from './model.ts';

export function startReadyWith(api: AssignmentsApi, dossier: string): StartReady {
  return async (plan) => {
    const list = await api.list(dossier);
    const able = list.adapters.filter((a) => !a.problem && !a.implement);
    const adapter = able.find((a) => a.name === list.preferred) ?? able[0];
    if (!adapter) throw new Error('No adapter here can take implement mode (only Codex can, once its SDK and CLI are set up under Settings, Agent), so nothing was started.');
    if (!list.repos.length) throw new Error(`${dossier} lists no repository with a local path, so implement mode has nothing to work in; add one with toil dossiers add-repo ${dossier} <folder>. Nothing was started.`);
    if (list.repos.length > 1) throw new Error(`${dossier} lists ${list.repos.length} repositories with a local path (${list.repos.map((r) => r.name).join(', ')}), and one plan can't say which each item needs; assign each item from its page instead. Nothing was started.`);
    const busy = new Set(list.assignments.filter((a) => a.mode === 'implement' && (a.state === 'queued' || a.state === 'working')).map((a) => a.item));
    const fresh = plan.items.filter((id) => !busy.has(id));
    for (const item of fresh) await api.assign({ dossier, item, mode: 'implement', adapter: adapter.name, repo: list.repos[0]!.name });
    const skipped = plan.items.length - fresh.length;
    return `Queued ${fresh.length === 1 ? 'one implement assignment' : `${fresh.length} implement assignments`} on ${adapter.label}${skipped ? `, leaving ${skipped} already queued or working` : ''}. They run ${list.settings.concurrent === 1 ? 'one at a time' : `${list.settings.concurrent} at a time`}; follow them in the Agents lane on the dashboard.`;
  };
}
