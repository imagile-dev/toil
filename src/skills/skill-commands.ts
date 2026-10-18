import { z } from 'zod';
import type { AnyArea } from '../core/area.js';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import type { CommandContext, ConfigAccess } from '../core/context.js';
import { allowWriteField } from '../core/run.js';
import { bundledSkills, connectionsInFile, describeConfig, installBundledSkill, SKILL_NAME, skillFilesFor, type SkillDescription } from './bundled.js';
import { AGENT_CHOICES, AGENT_NAMES, agentOf, DEFAULT_AGENT, rootsOf, skillsDir, slashes } from './folders.js';
import { join } from 'node:path';

/**
 * `toil skill install | show`: the toil skill itself, as opposed to the
 * `skills` commands, which manage marketplaces of other people's skills.
 *
 * `install` writes the skill toil carries into one agent host's skills folder
 * and records it as bundled. It changes files outside the workspace, so it is
 * CLI only and needs --allow-write, as `skills marketplace add` does: a person
 * types it once. After that toil keeps it current itself (src/skills/bundled.ts),
 * which is why there is no update command to forget. `show` reads what is
 * installed and what toil would write now, and is served over MCP too.
 * Self-service, in the sense that nobody else was ever going to do it.
 */

/** The config the description is generated from, and which connections came from env vars alone. */
function describe(ctx: CommandContext<unknown>, areas: readonly AnyArea[]): SkillDescription {
  const { config } = access(ctx);
  return describeConfig(
    config,
    areas.map((a) => a.name),
    connectionsInFile(config.files.global),
  );
}

function access(ctx: CommandContext<unknown>): ConfigAccess {
  if (!ctx.manage) throw new Error('A skill command ran without ctx.manage; define it with defineConfigCommand.');
  return ctx.manage;
}

/** What the output says about connections that only env vars define. */
function envNote(d: SkillDescription): string | null {
  if (d.envOnly.length === 0) return null;
  return `The description names connections set only by TOIL_* env vars (${d.envOnly.join(', ')}), because they are set in this process. A rewrite in a process without them leaves them out.`;
}

export function skillCommands(areas: readonly AnyArea[]): AnyCommand[] {
  const install = defineConfigCommand({
    path: ['skill', 'install'],
    description: "Install the toil skill into an agent's skills folder; toil keeps it current from then on",
    input: z.object({
      agent: z.enum(AGENT_NAMES).optional().describe(`Agent host whose skills folder to use: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})`),
      claude: z.boolean().optional().describe('Shorthand for agent claude-code'),
      scope: z.enum(['user', 'project']).optional().describe('user (default: the home folder) or project (the repository root)'),
      ...allowWriteField,
    }),
    writes: true,
    kind: 'cli-only',
    options: [
      { flags: '--agent <agent>', field: 'agent', description: `Target agent host: ${AGENT_CHOICES} (default: ${DEFAULT_AGENT})` },
      { flags: '--claude', field: 'claude', description: 'Shorthand for --agent claude-code' },
      { flags: '--scope <scope>', field: 'scope', description: 'Installation scope: project | user (default: user)' },
    ],
    examples: [{ allowWrite: true }, { agent: 'github-copilot', scope: 'project', allowWrite: true }, { claude: true, allowWrite: true }],
    run: async (input, ctx) => {
      const roots = rootsOf(ctx);
      const agent = agentOf(input);
      const scope = input.scope ?? 'user';
      const dir = skillsDir(agent, scope, roots);
      const d = describe(ctx, areas);
      const { replaced } = installBundledSkill({ agent, scope, dir }, d, ctx.version);
      const note = envNote(d);
      if (note) ctx.warn({ code: 'SKILL_ENV_ONLY', message: note });
      return {
        skill: SKILL_NAME,
        agent,
        scope,
        path: slashes(join(dir, SKILL_NAME)),
        replaced,
        files: Object.keys(skillFilesFor(d)).length,
        toilVersion: ctx.version,
        description: d.description,
        areas: d.areas,
        engines: d.engines,
        envOnly: d.envOnly,
        envNote: note,
        kept: 'toil rewrites this skill itself when a connection is added, changed or removed, and when another toil version runs; there is nothing to update by hand.',
      };
    },
  });

  const show = defineConfigCommand({
    path: ['skill', 'show'],
    description: 'Show the toil skill: the description toil writes for this config, and every installed copy and whether it is current',
    toolDescription:
      "Shows the bundled toil skill: the description toil generates from the configured areas and database engines (names only), the connections that come only from TOIL_* env vars, and every copy installed with toil skill install in the agent skills folders (path, toil version, whether it is current). Read-only; installing is toil skill install, on the CLI.",
    input: z.object({}),
    writes: false,
    examples: [{}],
    run: async (_input, ctx) => {
      const d = describe(ctx, areas);
      const installed = bundledSkills(rootsOf(ctx), d, ctx.version, ctx.warn);
      return {
        skill: SKILL_NAME,
        toilVersion: ctx.version,
        description: d.description,
        areas: d.areas,
        engines: d.engines,
        envOnly: d.envOnly,
        envNote: envNote(d),
        installed,
        total: installed.length,
      };
    },
  });

  return [install, show];
}
