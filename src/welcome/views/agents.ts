import { AGENT_CLIENTS, agentScreen, type AgentClient } from '../screens.js';
import { PALETTE, paint } from '../term.js';
import type { View } from '../view.js';

/**
 * The Agents module: pick a client, pick the areas it should see, and get the
 * snippet that registers `toil mcp` with it. Nothing is written anywhere: the
 * snippet is printed for you to paste, since editing another program's config
 * is a change request we'd rather you filed with yourself.
 */

export const agentsView: View = {
  title: () => 'Connect an agent',
  body: (caps) => [paint(caps, PALETTE.muted, 'Which agent?')],
  items: () => AGENT_CLIENTS.map((c) => ({ label: c.label, hint: '', action: { go: 'agent-areas', params: { client: c.id } } })),
};

const clientLabel = (id: string | undefined) => AGENT_CLIENTS.find((c) => c.id === id)?.label ?? '';

export const agentAreas: View = {
  title: (p) => clientLabel(p.frame.params.client),
  body: (caps) => [
    paint(caps, PALETTE.amber, 'Which areas should it see?'),
    '',
    paint(caps, PALETTE.muted, 'Space ticks an area, enter goes on. Tick none for every area.'),
  ],
  checklist: {
    options: (p) =>
      p.data.mcpAreas.map((name) => ({ id: name, label: name, hint: name === 'connections' ? 'List and test your connections' : (p.data.areas.find((a) => a.name === name)?.description ?? '') })),
    confirm: (checked, p) => ({ go: 'agent', params: { client: p.frame.params.client!, areas: checked.join(',') } }),
  },
};

export const agentView: View = {
  title: (p) => (p.frame.params.areas ? p.frame.params.areas : 'every area'),
  body: (caps, p) => agentScreen(caps, p.data, (p.frame.params.client ?? 'claude') as AgentClient, p.frame.params.areas ? p.frame.params.areas.split(',') : []),
};
