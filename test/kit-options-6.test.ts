import { describe, expect, it } from 'vitest';
import { commands as alationCommands } from '../src/areas/alation/index.js';
import { adoArea } from '../src/areas/ado/area.js';
import { loadConfig } from '../src/core/config.js';
import { resolveConnection } from '../src/core/connection.js';
import { runCli } from './harness/cli.js';
import { testContext } from './harness/context.js';
import { connectMcp } from './harness/mcp.js';
import { config } from './fixtures/alation.fixture.js';

/**
 * The sixth batch of integration-kit fixes (#68), for what no one area's
 * suite can show on its own. Filed in triplicate, read once.
 */

describe('an input error over MCP names the field, on the CLI the flag', () => {
  it('rewords the message and fix, keeping the code, for a real area command', async () => {
    const { context } = testContext({ config });
    const cli = await runCli(['alation', 'search', 'customer', '--limit', '20000'], { commands: alationCommands, context });
    expect(cli.envelope?.error).toMatchObject({
      code: 'INVALID_INPUT',
      message: '--limit must be at most 10000',
      fix: 'Pass --limit 10000 or less, and page on with --offset.',
    });

    const mcp = await connectMcp({ commands: alationCommands, context });
    try {
      const { envelope } = await mcp.call('alation_search', { query: 'customer', limit: '20000' });
      expect(envelope.error).toMatchObject({
        code: 'INVALID_INPUT',
        message: 'limit must be at most 10000',
        fix: 'Pass limit 10000 or less, and page on with offset.',
      });
      // Only the error is reworded: everything else in the envelope matches the CLI's.
      expect({ ...envelope, error: null, meta: null }).toEqual({ ...cli.envelope, error: null, meta: null });
    } finally {
      await mcp.close();
    }
  });
});

describe("ado's fieldAliases, now that --save is gone", () => {
  it('come from TOIL_ADO_FIELD_ALIASES as a JSON object, the way a custom alias is set without a file', async () => {
    const env = { TOIL_ADO_BASE_URL: 'https://ado.imagile.dev', TOIL_ADO_PAT: 'p', TOIL_ADO_FIELD_ALIASES: '{"effortdays":"MyOrg.EffortDays"}' };
    const loaded = loadConfig({ env, cwd: '/nowhere', home: '/nowhere', areas: [adoArea] });
    const connection = await resolveConnection(loaded, adoArea, undefined, () => {});
    expect(connection.fieldAliases).toEqual({ effortdays: 'MyOrg.EffortDays' });
  });
});
