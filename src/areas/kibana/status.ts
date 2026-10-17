import { z } from 'zod';
import { kibanaArea } from './area.js';
import { kibanaStatus } from './client.js';

/**
 * Kibana's version and overall status, from GET /api/status. An unhealthy
 * Kibana answers 503 with its status in the body, and that is reported, not
 * failed: a status page that only works when all is well is a brochure.
 * https://www.elastic.co/docs/api/doc/kibana/operation/operation-get-status
 */

interface StatusResponse {
  name?: string;
  uuid?: string;
  version?: { number?: string; build_flavor?: string };
  status?: { overall?: { level?: string; summary?: string; state?: string; title?: string } };
}

export const statusCommand = kibanaArea.command({
  path: ['kibana', 'status'],
  description: 'Show Kibana version and overall status',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => {
    const data = await kibanaStatus<StatusResponse>(ctx);
    const overall = data.status?.overall;
    return {
      name: data.name,
      uuid: data.uuid,
      version: data.version?.number,
      buildFlavor: data.version?.build_flavor,
      // 8.x reports level/summary; 7.x reported state/title.
      status: overall?.level ?? overall?.state,
      summary: overall?.summary ?? overall?.title,
    };
  },
});

export const statusCommands = [statusCommand];
