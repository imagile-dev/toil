import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { sonarArea } from './area.js';
import { hotspotsPage, issuesPage, projectsPage, sonar, sonarAll, type SonarContext } from './client.js';

/**
 * The five SonarQube commands. Four act on one project, taken from --project
 * or the connection's `project` (usually `defaults.sonar.project`); `projects`
 * lists them. Without --all, `data` is the server's page as it came; with
 * --all, the items of every page in one flat list. Paging parameters reach
 * the server exactly as typed, `NaN` included, because the server is the
 * department that rejects forms.
 */

const DEFAULT_METRICS = 'coverage,duplicated_lines_density,bugs,vulnerabilities,code_smells,sqale_rating,reliability_rating,security_rating,ncloc';

/** A number the predecessor read with parseInt: text stays text until then. */
const intText = z.union([z.number(), z.string()]);
const parseIntText = (value: number | string | undefined, fallback: string) => parseInt(String(value ?? fallback), 10);

/** The project from --project or the connection, with the predecessor's error when neither has one. */
function projectOf(ctx: SonarContext): string {
  const project = ctx.context.project;
  if (!project) {
    throw new ToilError('INVALID_INPUT', 'No project specified. Use --project or set defaults.sonar.project in config.', {
      fix: `Pass --project <key>, or set project under defaults.sonar in your toil config (${sonarArea.envName('project')} for the default connection).`,
    });
  }
  return project;
}

export const qualityGateCommand = sonarArea.command({
  path: ['sonar', 'quality-gate'],
  description: 'Get quality gate status for a project',
  input: z.object({
    branch: z.string().optional().describe('Branch name'),
  }),
  writes: false,
  context: { project: 'optional' },
  options: [{ flags: '--branch <name>', field: 'branch', description: 'Branch name' }],
  examples: [{ project: 'imagile-api' }, { project: 'imagile-api', branch: 'release-1.2' }],
  run: async (input, ctx) => {
    const projectKey = projectOf(ctx);
    return sonar(ctx, '/qualitygates/project_status', { projectKey, ...(input.branch ? { branch: input.branch } : {}) });
  },
});

export const issuesCommand = sonarArea.command({
  path: ['sonar', 'issues'],
  description: 'Search/list issues for a project',
  input: z.object({
    severities: z.string().optional().describe('Filter by severity: BLOCKER,CRITICAL,MAJOR,MINOR,INFO (comma-separated)'),
    types: z.string().optional().describe('Filter by type: BUG,VULNERABILITY,CODE_SMELL (comma-separated)'),
    statuses: z.string().optional().describe('Filter by status: OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED (comma-separated)'),
    branch: z.string().optional().describe('Branch name'),
    resolved: z.string().optional().describe('Filter resolved issues: true or false'),
    page: intText.optional().describe('Page number (1-based) (default: "1")'),
    pageSize: intText.optional().describe('Results per page (max 500) (default: "100")'),
    all: z.boolean().optional().describe('Fetch every page (500 per request; ignores --page/--page-size); the result can be large'),
  }),
  writes: false,
  context: { project: 'optional' },
  options: [
    { flags: '--severities <list>', field: 'severities', description: 'Filter by severity: BLOCKER,CRITICAL,MAJOR,MINOR,INFO (comma-separated)' },
    { flags: '--types <list>', field: 'types', description: 'Filter by type: BUG,VULNERABILITY,CODE_SMELL (comma-separated)' },
    { flags: '--statuses <list>', field: 'statuses', description: 'Filter by status: OPEN,CONFIRMED,REOPENED,RESOLVED,CLOSED (comma-separated)' },
    { flags: '--branch <name>', field: 'branch', description: 'Branch name' },
    { flags: '--resolved <bool>', field: 'resolved', description: 'Filter resolved issues: true or false' },
    { flags: '--page <n>', field: 'page', description: 'Page number (1-based) (default: "1")' },
    { flags: '--page-size <n>', field: 'pageSize', description: 'Results per page (max 500) (default: "100")' },
    { flags: '--all', field: 'all', description: 'Fetch every page (500 per request; ignores --page/--page-size); the result can be large' },
  ],
  examples: [
    { project: 'imagile-api' },
    { project: 'imagile-api', severities: 'BLOCKER,CRITICAL', types: 'BUG,VULNERABILITY', statuses: 'OPEN,REOPENED', branch: 'main', resolved: 'false', page: '2', pageSize: '50' },
    { project: 'imagile-api', all: true },
  ],
  run: async (input, ctx) => {
    const params = {
      componentKeys: projectOf(ctx),
      severities: input.severities,
      types: input.types,
      statuses: input.statuses,
      branch: input.branch,
      // Suspected bug (#92 item 4): anything but the exact string "true" is sent as false.
      resolved: input.resolved !== undefined ? String(input.resolved === 'true') : undefined,
    };
    if (input.all) return sonarAll(`/issues/search`, ctx, params, issuesPage, `SonarQube issues for ${params.componentKeys}`);
    // Suspected bug (#92 item 5): no validation, so NaN and sizes over 500 reach the server.
    return sonar(ctx, '/issues/search', { ...params, p: parseIntText(input.page, '1'), ps: parseIntText(input.pageSize, '100') });
  },
});

export const measuresCommand = sonarArea.command({
  path: ['sonar', 'measures'],
  description: 'Get key metrics for a project',
  input: z.object({
    metrics: z.string().optional().describe(`Comma-separated metric keys (default: "${DEFAULT_METRICS}")`),
    branch: z.string().optional().describe('Branch name'),
  }),
  writes: false,
  context: { project: 'optional' },
  options: [
    { flags: '--metrics <list>', field: 'metrics', description: `Comma-separated metric keys (default: "${DEFAULT_METRICS}")` },
    { flags: '--branch <name>', field: 'branch', description: 'Branch name' },
  ],
  examples: [{ project: 'imagile-api' }, { project: 'imagile-api', metrics: 'coverage,bugs', branch: 'main' }],
  run: async (input, ctx) => {
    const component = projectOf(ctx);
    return sonar(ctx, '/measures/component', { component, metricKeys: input.metrics ?? DEFAULT_METRICS, ...(input.branch ? { branch: input.branch } : {}) });
  },
});

export const projectsCommand = sonarArea.command({
  path: ['sonar', 'projects'],
  description: 'Search/list projects',
  input: z.object({
    query: z.string().optional().describe('Search query'),
    page: intText.optional().describe('Page number (1-based) (default: "1")'),
    pageSize: intText.optional().describe('Results per page (default: "100")'),
    all: z.boolean().optional().describe('Fetch every page (500 per request); the result can be large'),
  }),
  writes: false,
  options: [
    { flags: '--query <text>', field: 'query', description: 'Search query' },
    { flags: '--page <n>', field: 'page', description: 'Page number (1-based) (default: "1")' },
    { flags: '--page-size <n>', field: 'pageSize', description: 'Results per page (default: "100")' },
    { flags: '--all', field: 'all', description: 'Fetch every page (500 per request); the result can be large' },
  ],
  examples: [{}, { query: 'imagile', page: '2', pageSize: '25' }, { query: 'imagile', all: true }],
  // Suspected bug (#92 item 2): api/projects/search needs Administer System, so other tokens likely get 403.
  run: async (input, ctx) => {
    if (input.all) return sonarAll('/projects/search', ctx, { q: input.query }, projectsPage, 'SonarQube projects');
    return sonar(ctx, '/projects/search', { q: input.query, p: parseIntText(input.page, '1'), ps: parseIntText(input.pageSize, '100') });
  },
});

export const hotspotsCommand = sonarArea.command({
  path: ['sonar', 'hotspots'],
  description: 'List security hotspots for a project',
  input: z.object({
    status: z.string().optional().describe('Filter: TO_REVIEW or REVIEWED'),
    resolution: z.string().optional().describe('Filter: FIXED,SAFE,ACKNOWLEDGED (comma-separated)'),
    branch: z.string().optional().describe('Branch name'),
    page: intText.optional().describe('Page number (1-based) (default: "1")'),
    pageSize: intText.optional().describe('Results per page (default: "100")'),
    all: z.boolean().optional().describe('Fetch every page (500 per request); the result can be large'),
  }),
  writes: false,
  context: { project: 'optional' },
  options: [
    { flags: '--status <status>', field: 'status', description: 'Filter: TO_REVIEW or REVIEWED' },
    { flags: '--resolution <list>', field: 'resolution', description: 'Filter: FIXED,SAFE,ACKNOWLEDGED (comma-separated)' },
    { flags: '--branch <name>', field: 'branch', description: 'Branch name' },
    { flags: '--page <n>', field: 'page', description: 'Page number (1-based) (default: "1")' },
    { flags: '--page-size <n>', field: 'pageSize', description: 'Results per page (default: "100")' },
    { flags: '--all', field: 'all', description: 'Fetch every page (500 per request); the result can be large' },
  ],
  examples: [
    { project: 'imagile-api' },
    // Suspected bug (#92 item 3): a comma list goes to the server as one value.
    { project: 'imagile-api', status: 'REVIEWED', resolution: 'FIXED,SAFE', branch: 'main', page: '1', pageSize: '20' },
    { project: 'imagile-api', all: true },
  ],
  run: async (input, ctx) => {
    const params = { projectKey: projectOf(ctx), status: input.status, resolution: input.resolution, branch: input.branch };
    if (input.all) return sonarAll('/hotspots/search', ctx, params, hotspotsPage, `SonarQube hotspots for ${params.projectKey}`);
    return sonar(ctx, '/hotspots/search', { ...params, p: parseIntText(input.page, '1'), ps: parseIntText(input.pageSize, '100') });
  },
});

export const sonarCommands = [qualityGateCommand, issuesCommand, measuresCommand, projectsCommand, hotspotsCommand];
