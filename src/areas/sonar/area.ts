import { z } from 'zod';
import { defineArea } from '../../core/area.js';
import type { SupportedVersion } from '../../core/supported.js';

/**
 * SonarQube Server: quality gates, issues, security hotspots, measures and
 * projects, read from the Web API under `/api`. Every command here reads; the
 * quality gate is reported, never adjudicated, which is more than most review
 * boards can say.
 */
export const sonarArea = defineArea({
  name: 'sonar',
  description: 'SonarQube Server: quality gates, issues, security hotspots, measures and projects',
  connection: z.object({
    baseUrl: z.url().describe('SonarQube server root, e.g. https://sonar.imagile.dev'),
    token: z.string().min(1).describe('SonarQube user token'),
    // Usually set once under defaults.sonar, so every SonarQube connection shares it.
    project: z.string().min(1).optional().describe('Default project key for quality-gate, issues, measures and hotspots'),
  }),
  secrets: ['token'],
  // SonarSource's own scanner reads SONAR_TOKEN, so CI that already runs a scan needs nothing more.
  fallbacks: { token: ['SONAR_TOKEN'] },
  context: {
    project: {
      description: 'SonarQube project key',
      flags: '--project <key>',
      scope: 'command',
      setting: 'project',
      // The contract's wording; core's fix names the flag, the setting and its env var.
      missing: { message: 'No project specified. Use --project or set defaults.sonar.project in config.' },
    },
  },
  request: (connection, area) => ({
    baseUrl: connection.baseUrl,
    headers: { Authorization: `Bearer ${connection.token}` },
    service: 'SonarQube',
    authFix: `SonarQube rejected the token on connection "${connection.name}". Generate a new user token under My Account → Security → Generate Tokens, then set token (${area.envName('token')}, or SONAR_TOKEN, for the default connection).`,
  }),
});

/** Not established: the commands use the unversioned Web API with a Bearer user token. The skill file and the site's integration data say the same. */
export const sonarSupported: SupportedVersion = {
  product: 'SonarQube Server',
  minimum: null,
  api: 'Web API',
  note: 'toil calls the unversioned Web API (/api/...) with a user token sent as a Bearer header. No release has been verified yet.',
};
