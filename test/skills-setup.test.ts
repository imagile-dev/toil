import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skillFiles, skillPages } from '../src/skill-pages.generated.js';
import { docsPath } from '../site/src/data/docs-path.mjs';
import { checkInvocation, invocations } from './harness/cli-lines.js';

/**
 * The setup page (#516) is the walkthrough an agent follows to set toil up for a
 * person, and the one place an agent is told how far it may go with a credential:
 * not an inch. It has to be real (its commands exist) and it has to keep the rule
 * (no secret passes through the agent). A walkthrough that shows a token flag
 * is a form with a field for the thing it swears it never asks for.
 */
const root = join(import.meta.dirname, '..');
const page = readFileSync(join(root, 'skills', 'toil', 'setup.md'), 'utf8').replace(/\r\n/g, '\n');
const lines = invocations(page).map((args) => args.join(' '));

describe('the setup page', () => {
  it('is in the skill index, installs with the skill and has a docs page in "Get started"', () => {
    expect(readFileSync(join(root, 'skills', 'toil', 'SKILL.md'), 'utf8')).toContain('`setup.md`');
    expect(skillFiles['setup.md']).toBe(page);
    expect(skillPages.setup).toBeDefined();
    const getStarted = (docsPath as Array<{ id: string; links: Array<{ href: string }> }>).find((g) => g.id === 'get-started')!;
    expect(getStarted.links.map((l) => l.href)).toContain('/docs/setup/');
  });

  it('shows only real commands with real flags, and finds enough to be sure it looked', () => {
    expect(lines.length).toBeGreaterThan(8);
    const bad = invocations(page)
      .map((args) => [args.join(' '), checkInvocation(args)] as const)
      .filter(([, problem]) => problem);
    expect(bad).toEqual([]);
  });

  it('asks the Toil UI question before it finds or creates anything', () => {
    const ui = page.indexOf('## 1. Ask about Toil UI first');
    expect(ui).toBeGreaterThan(0);
    expect(ui).toBeLessThan(page.indexOf('## 3. Find what they work on'));
    expect(ui).toBeLessThan(page.indexOf('connections add'));
  });

  it('creates connections from non-secret settings only, and hands each secret to the person', () => {
    expect(lines).toContain('connections add github --area github --set baseUrl=https://api.github.com');
    expect(page).toContain('toil connections login');
    expect(page).toContain('Settings, Connections');
    expect(page).toMatch(/They enter every secret, never you/);
    expect(page).toMatch(/revoke/);
    expect(page).toContain('`writes` stays off');
  });

  it('never shows a secret value, a token flag or a secret in a command', () => {
    for (const line of lines) {
      expect(line, line).not.toMatch(/--(token|pat|password|api-?token|secret|api-?key)\b/i);
      expect(line, line).not.toMatch(/--set\s+(token|apiToken|pat|password|secret|apiKey)=/i);
    }
    expect(page).not.toMatch(/ghp_|github_pat_|xox[bp]-|Bearer\s+[A-Za-z0-9]{8,}|keychain:/);
    expect(page).not.toMatch(/TOIL_[A-Z_]*(TOKEN|PASSWORD|PAT|API_KEY)=/);
  });

  it('has the person, never the agent, turn writes on', () => {
    expect(page).toMatch(/turn\s+it on\s+themselves/);
    expect(page).toMatch(/Don't turn\s+it on for them/);
  });

  it('is what the home page and install.md lead with: the same install commands and the same prompt', () => {
    const start = JSON.parse(readFileSync(join(root, 'site', 'src', 'data', 'start.json'), 'utf8')) as { agentCommands: string[]; agentPrompt: string };
    const install = readFileSync(join(root, 'skills', 'toil', 'install.md'), 'utf8');
    for (const command of start.agentCommands) {
      expect(install, command).toContain(command);
      if (command.startsWith('toil ')) expect(checkInvocation(command.split(' ').slice(1)), command).toBeUndefined();
    }
    expect(install.replace(/\s+/g, ' ')).toContain(start.agentPrompt.replace(/\.$/, ''));
    expect(start.agentPrompt).toMatch(/setup skill/);
  });
});
