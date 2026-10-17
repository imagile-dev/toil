import { z } from 'zod';
import { saucelabsArea } from './area.js';
import { countOf, id, intText, parseChoice, parseIntOption, RDA, sauce, TEAM_MGMT } from './client.js';

/**
 * The account-wide commands: service status, concurrency (which also proves
 * the credentials), the platform catalog, Appium versions and the user
 * directory. All of them read; none of them needs a ticket.
 */

const PLATFORM_APIS = ['all', 'appium', 'webdriver'] as const;

export const statusCommand = saucelabsArea.command({
  path: ['saucelabs', 'status'],
  description: 'Sauce Labs service status (operational flag, wait time)',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => sauce(ctx, '/rest/v1/info/status'),
});

export const concurrencyCommand = saucelabsArea.command({
  path: ['saucelabs', 'concurrency'],
  description: 'Concurrency allowed and in use for your organization and team (also verifies credentials)',
  toolDescription: 'Concurrency allowed and in use for your organization and team. Scoped to the configured username, so it is also the cheapest check that the username and access key belong together.',
  input: z.object({}),
  writes: false,
  examples: [{}],
  // Sauce has no "current user" endpoint; this one is scoped to the username, so a key from another user is refused.
  run: async (_input, ctx) => sauce(ctx, `/rest/v1.2/users/${id(ctx.connection.username)}/concurrency`),
});

export const platformsCommand = saucelabsArea.command({
  path: ['saucelabs', 'platforms'],
  description: 'Supported OS/browser/device platforms',
  input: z.object({
    api: z.string().optional().describe('Automation API: all, appium, webdriver (default: "all")'),
  }),
  writes: false,
  options: [{ flags: '--api <api>', field: 'api', description: 'Automation API: all, appium, webdriver (default: "all")' }],
  examples: [{}, { api: 'Appium' }],
  run: async (input, ctx) => {
    const api = parseChoice(input.api ?? 'all', PLATFORM_APIS, '--api');
    const data = await sauce<unknown>(ctx, `/rest/v1/info/platforms/${api}`);
    return { api, count: countOf(data), platforms: data };
  },
});

export const appiumVersionsCommand = saucelabsArea.command({
  path: ['saucelabs', 'appium-versions'],
  description: 'Appium versions available for real-device sessions, with end-of-life dates',
  input: z.object({}),
  writes: false,
  examples: [{}],
  run: async (_input, ctx) => sauce(ctx, `${RDA}/appium/versions`),
});

export const usersCommand = saucelabsArea.command({
  path: ['saucelabs', 'users'],
  description: 'Look up users in your organization',
  input: z.object({
    username: z.string().optional().describe('Exact username'),
    phrase: z.string().optional().describe('Search username, name, and email'),
    limit: intText.optional().describe('Maximum results (default 20, max 100)'),
    offset: intText.optional().describe('Number of results to skip'),
  }),
  writes: false,
  options: [
    { flags: '--username <username>', field: 'username', description: 'Exact username' },
    { flags: '--phrase <text>', field: 'phrase', description: 'Search username, name, and email' },
    { flags: '--limit <n>', field: 'limit', description: 'Maximum results (default 20, max 100)' },
    { flags: '--offset <n>', field: 'offset', description: 'Number of results to skip' },
  ],
  examples: [{}, { username: 'imagile-qa', phrase: 'imagile', limit: '50', offset: '50' }],
  run: async (input, ctx) =>
    sauce(ctx, `${TEAM_MGMT}/users/`, {
      query: {
        username: input.username,
        phrase: input.phrase,
        limit: parseIntOption(input.limit, '--limit'),
        offset: parseIntOption(input.offset, '--offset'),
      },
    }),
});

export const accountCommands = [statusCommand, concurrencyCommand, platformsCommand, appiumVersionsCommand, usersCommand];
