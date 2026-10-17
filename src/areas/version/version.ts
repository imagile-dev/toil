import { z } from 'zod';
import { defineCommand } from '../../core/command.js';

export const versionCommand = defineCommand({
  path: ['version'],
  description: "Show toil's version and the runtime it is running on",
  toolDescription: "Returns toil's version, the Node.js version, platform and architecture. Use it to check which toil an agent is talking to.",
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => ({
    version: ctx.version,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
  }),
});
