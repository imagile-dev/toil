import { z } from 'zod';
import { buildUrl, restRequest } from '../../core/rest.js';
import { exchangeToken, forgetToken, tokenKey } from '../../core/token.js';
import { alationArea, authFix, tokenExchange, userIdOf } from './area.js';

/**
 * `token status`: mints a fresh access token from the refresh token, asks
 * Alation to validate it, and reports what Alation says, minus the token.
 * Each run leaves another 24-hour token on the server (#77 item 3), which is
 * what happens when the only way to check a badge is to print a new one.
 */

export const tokenStatusCommand = alationArea.command({
  path: ['alation', 'token', 'status'],
  description: 'Mint an API access token from the configured refresh token and report its expiry (verifies credentials)',
  input: z.object({}),
  writes: false,
  // The exchange and the validation are POSTs that change nothing in the catalog.
  queryByPost: true,
  examples: [{}],
  run: async (_input, ctx) => {
    const connection = ctx.connection;
    const exchange = tokenExchange(connection);
    const fix = authFix(connection.name, alationArea.envName('refreshToken'), alationArea.envName('userId'));
    // The same cache entry data requests use (core's scope is area/connection): the
    // predecessor always minted a new token here, so the cached one is dropped first.
    // This copies core's scope format until core exports it (a kit gap); the test
    // "mints a new token even when one is cached" fails if the two drift apart.
    const scope = `${alationArea.name}/${connection.name}`;
    forgetToken(tokenKey(scope, exchange));
    const token = await exchangeToken({ fetch: ctx.fetch, signal: ctx.signal, scope, service: 'Alation', authFix: fix }, exchange);
    const data = await restRequest<Record<string, unknown> | undefined>(
      ctx,
      buildUrl(connection.baseUrl, 'integration/v1/validateAPIAccessToken/'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ api_access_token: token, user_id: userIdOf(connection) }),
      },
      { service: 'Alation', authFix: fix },
    );
    const { api_access_token: _omit, ...rest } = data ?? {};
    void _omit;
    return rest;
  },
});

export const tokenCommands = [tokenStatusCommand];
