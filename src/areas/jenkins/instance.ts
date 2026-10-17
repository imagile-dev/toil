import { z } from 'zod';
import { defineConfigCommand } from '../../core/command.js';
import { ToilError } from '../../core/errors.js';
import { jenkinsArea } from './area.js';

/**
 * `jenkins instance list | add | remove`. A named instance is a jenkins
 * connection now. `list` shows them, token masked, through both front doors.
 * `add` and `remove` stay at their old paths, CLI only, and answer with the
 * `toil connections` command that does the job, since only those commands
 * write config (docs/divergences/jenkins.json). Two registers of the same
 * servers would need a reconciliation meeting.
 */
export const instanceListCommand = defineConfigCommand({
  path: ['jenkins', 'instance', 'list'],
  description: 'List configured Jenkins instances (API tokens masked)',
  toolDescription:
    'Lists every Jenkins connection (each one a named instance that --instance or the instance field selects): its name, baseUrl and username, with the API token shown only as "***" when one is set. Never returns a secret.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    if (!ctx.manage) throw new Error('jenkins instance list ran without ctx.manage; define it with defineConfigCommand.');
    const instances = Object.entries(ctx.manage.config.connections)
      .filter(([, conn]) => conn.area === jenkinsArea.name)
      .map(([name, conn]) => ({
        name,
        baseUrl: conn.baseUrl,
        username: conn.username,
        apiToken: conn.apiToken ? '***' : undefined,
        ...(conn.instance !== undefined ? { instance: conn.instance } : {}),
      }));
    return { instances };
  },
});

const ADD_FLAGS = {
  name: 'Instance name used with --instance',
  baseUrl: 'Jenkins base URL (e.g. jenkins.imagile.dev)',
  username: 'Jenkins username',
  apiToken: 'Jenkins API token (prompted for when omitted on an interactive terminal, keeping it out of shell history)',
  force: 'Overwrite an instance that already uses this name',
};

export const instanceAddCommand = defineConfigCommand({
  path: ['jenkins', 'instance', 'add'],
  description: 'Add a named Jenkins instance: replaced by toil connections add <name> --area jenkins',
  input: z.object({
    name: z.string().describe(ADD_FLAGS.name),
    baseUrl: z.string().describe(ADD_FLAGS.baseUrl),
    username: z.string().optional().describe(ADD_FLAGS.username),
    apiToken: z.string().optional().describe(ADD_FLAGS.apiToken),
    force: z.boolean().optional().describe(ADD_FLAGS.force),
  }),
  writes: false,
  kind: 'cli-only',
  options: [
    { flags: '--name <name>', field: 'name', description: ADD_FLAGS.name },
    { flags: '--base-url <url>', field: 'baseUrl', description: ADD_FLAGS.baseUrl },
    { flags: '--username <user>', field: 'username', description: ADD_FLAGS.username },
    { flags: '--api-token <token>', field: 'apiToken', description: ADD_FLAGS.apiToken },
    { flags: '--force', field: 'force', description: ADD_FLAGS.force },
  ],
  examples: [{ name: 'prod', baseUrl: 'https://jenkins.imagile.dev', username: 'ci-bot', force: true }],
  run: async (input) => {
    throw new ToilError('INVALID_INPUT', 'toil jenkins instance add no longer edits config: a named Jenkins instance is a jenkins connection. Nothing was saved.', {
      fix: `Run toil connections add ${input.name} --area jenkins, which asks for baseUrl (${input.baseUrl}), username and the API token and keeps the token in the OS credential store. Then pass --instance ${input.name}.`,
    });
  },
});

export const instanceRemoveCommand = defineConfigCommand({
  path: ['jenkins', 'instance', 'remove'],
  description: 'Remove a named Jenkins instance: replaced by toil connections remove <name>',
  input: z.object({ name: z.string().describe('Instance name to remove') }),
  writes: false,
  kind: 'cli-only',
  options: [{ flags: '--name <name>', field: 'name', description: 'Instance name to remove' }],
  examples: [{ name: 'prod' }],
  run: async (input) => {
    throw new ToilError('INVALID_INPUT', 'toil jenkins instance remove no longer edits config: a named Jenkins instance is a jenkins connection. Nothing was removed.', {
      fix: `Run toil connections remove ${input.name}, which also deletes its token from the OS credential store. toil jenkins instance list shows the names.`,
    });
  },
});

export const instanceCommands = [instanceListCommand, instanceAddCommand, instanceRemoveCommand];
