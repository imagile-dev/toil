import { z } from 'zod';
import { defineCommand } from '../../core/command.js';
import { CONTRACT_VERSION } from '../../core/envelope.js';
import { COMMIT } from '../../version.js';

export const versionCommand = defineCommand({
  path: ['version'],
  description: "Show toil's version and the runtime it is running on",
  toolDescription:
    "Returns toil's version, the command contract's version (contractVersion, which goes up only with a breaking change), the commit the build came from (commit, or null when the build didn't record one), the Node.js version, platform and architecture. Use it to check which toil an agent is talking to.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => ({
    version: ctx.version,
    contractVersion: CONTRACT_VERSION,
    commit: COMMIT,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }),
});
