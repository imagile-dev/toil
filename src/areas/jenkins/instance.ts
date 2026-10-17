import { z } from 'zod';
import { defineConfigCommand } from '../../core/command.js';
import { ToilError } from '../../core/errors.js';

/**
 * `jenkins instance remove`. A named instance is a jenkins connection now.
 * `instance list` and `instance add` are core's `connections list` and
 * `connections add` with the area fixed (`coreAliases` in area.ts), so this
 * area never sees the config. `connections remove` takes no area to fix, so
 * this one stays a CLI-only signpost to it until core can alias it too. It
 * reads nothing it's handed: a forwarding address, not a second filing cabinet.
 */
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

export const instanceCommands = [instanceRemoveCommand];
