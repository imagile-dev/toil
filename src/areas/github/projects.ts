import { z } from 'zod';
import { ToilError } from '../../core/errors.js';
import { githubArea } from './area.js';
import { exampleGraphqlCursor, githubGraphqlList, targetOwner, type GitHubContext, type GraphqlConnection } from './client.js';
import { intText, pageFields, pageOptions, parseIntText } from './input.js';

/**
 * Projects (v2), GitHub's boards, over GraphQL: an owner's projects, a
 * project's fields (status, iterations, estimates) and its items with their
 * field values. Projects belong to an owner, not a repository, so only
 * --owner is read. A board is a spreadsheet that has been told it is agile.
 *
 * Docs, checked 2026-10-18:
 * https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
 * (the queries and the read:project scope) and the GraphQL reference for
 * ProjectV2, ProjectV2Item and the ProjectV2ItemField*Value types.
 */

const PROJECTS = `
  query($owner: String!, $first: Int!, $after: String) {
    repositoryOwner(login: $owner) {
      ... on ProjectV2Owner {
        projectsV2(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id number title shortDescription url public closed createdAt updatedAt }
        }
      }
    }
  }
`;

const FIELDS = `
  query($owner: String!, $project: Int!, $first: Int!, $after: String) {
    repositoryOwner(login: $owner) {
      ... on ProjectV2Owner {
        projectV2(number: $project) {
          fields(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              __typename
              ... on ProjectV2FieldCommon { id name dataType }
              ... on ProjectV2SingleSelectField { options { id name } }
              ... on ProjectV2IterationField {
                configuration {
                  duration
                  startDay
                  iterations { id title startDate duration }
                  completedIterations { id title startDate duration }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/** Values past the first 100 on one item are cut, with a warning; a project has at most 50 fields today. */
const ITEMS = `
  query($owner: String!, $project: Int!, $first: Int!, $after: String) {
    repositoryOwner(login: $owner) {
      ... on ProjectV2Owner {
        projectV2(number: $project) {
          items(first: $first, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              type
              isArchived
              createdAt
              updatedAt
              content {
                __typename
                ... on Issue { number title state url updatedAt repository { nameWithOwner } }
                ... on PullRequest { number title state url updatedAt repository { nameWithOwner } }
                ... on DraftIssue { title }
              }
              fieldValues(first: 100) {
                pageInfo { hasNextPage }
                nodes {
                  __typename
                  ... on ProjectV2ItemFieldTextValue { text }
                  ... on ProjectV2ItemFieldNumberValue { number }
                  ... on ProjectV2ItemFieldDateValue { date }
                  ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
                  ... on ProjectV2ItemFieldIterationValue { title iterationId startDate duration }
                  ... on ProjectV2ItemFieldValueCommon { field { ... on ProjectV2FieldCommon { id name } } }
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface Owner {
  repositoryOwner?: { projectsV2?: GraphqlConnection<unknown>; projectV2?: Record<string, GraphqlConnection<unknown> | undefined> | null } | null;
}

interface GraphqlError {
  type?: string;
  message?: string;
  extensions?: { code?: string };
}

const SCOPES = 'A classic personal access token needs read:project (project to write); a fine-grained token needs Projects: read under Organization permissions, and works for organization projects only, so a user\'s own projects need a classic token.';

/**
 * GitHub's GraphQL errors as toil's: a missing scope is AUTH, a project or
 * owner that isn't there NOT_FOUND, and a field the schema doesn't have
 * (Projects on an older Enterprise Server) UNSUPPORTED, each in plain words.
 */
async function projectsCall<T>(owner: string, what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (!(err instanceof ToilError) || err.code !== 'HTTP') throw err;
    const errors = ((err.details as { errors?: unknown } | undefined)?.errors ?? []) as GraphqlError[];
    if (!Array.isArray(errors)) throw err;
    if (errors.some((e) => e.type === 'INSUFFICIENT_SCOPES')) throw new ToilError('AUTH', `The GitHub token can't read ${what}: ${errors[0]?.message ?? 'missing scope'}`, { fix: SCOPES });
    if (errors.some((e) => e.type === 'NOT_FOUND')) {
      throw new ToilError('NOT_FOUND', `GitHub found no ${what}: ${errors.find((e) => e.type === 'NOT_FOUND')?.message ?? ''}`.trim(), {
        fix: `Check --owner (${owner}) and --project, and that the token can see the project. ${SCOPES}`,
      });
    }
    if (errors.some((e) => e.extensions?.code === 'undefinedField' || e.extensions?.code === 'undefinedType' || /doesn't exist on type|unknown type/i.test(e.message ?? ''))) {
      throw new ToilError('UNSUPPORTED', `This GitHub server's GraphQL API has no Projects (v2), so toil can't read ${what}.`, {
        fix: 'Use a GitHub Enterprise Server release that has Projects (the new project boards); classic projects are not supported.',
      });
    }
    throw err;
  }
}

const projectNumber = intText.describe('Project number (from projects list, or the project URL)');
const projectOption = { flags: '--project <number>', field: 'project', description: 'Project number (from projects list, or the project URL)' } as const;

export const listProjectsCommand = githubArea.command({
  path: ['github', 'projects', 'list'],
  description: "List an owner's projects (v2)",
  toolDescription: "Lists the Projects (v2) an organization or user owns: id, number, title, shortDescription, url, public, closed, createdAt, updatedAt. Needs read:project on a classic token, or Projects: read on a fine-grained one (organization projects only). With limit, pass meta.page.nextCursor as cursor for the next page.",
  queryByPost: true,
  input: z.object({ ...pageFields('projects') }),
  writes: false,
  options: [...pageOptions('projects')],
  examples: [{ owner: 'imagile' }, { owner: 'imagile', repo: 'unused', limit: 1, cursor: exampleGraphqlCursor() }],
  run: async (input, ctx) => {
    const owner = targetOwner(ctx);
    const what = `projects owned by ${owner}`;
    return projectsCall(owner, what, () => githubGraphqlList(ctx, PROJECTS, { owner }, (d) => (d as Owner).repositoryOwner?.projectsV2, what, input));
  },
});

function inProject(ctx: GitHubContext, input: { project: number | string; limit?: number | undefined; cursor?: string | undefined }, query: string, key: 'fields' | 'items', noun: string) {
  const owner = targetOwner(ctx);
  const project = parseIntText(input.project);
  const what = `${noun} of project ${project} owned by ${owner}`;
  return projectsCall(owner, what, () => githubGraphqlList(ctx, query, { owner, project }, (d) => (d as Owner).repositoryOwner?.projectV2?.[key], what, input));
}

export const projectFieldsCommand = githubArea.command({
  path: ['github', 'projects', 'fields'],
  description: "List a project's fields, with single-select options and iterations",
  toolDescription:
    "Lists a project's fields: id, name and dataType (TEXT, NUMBER, DATE, SINGLE_SELECT, ITERATION, and the built-in ones), the options of a single-select field such as Status, and an iteration field's configuration with its current and completed iterations. With limit, pass meta.page.nextCursor as cursor for the next page.",
  queryByPost: true,
  input: z.object({ project: projectNumber, ...pageFields('fields') }),
  writes: false,
  options: [projectOption, ...pageOptions('fields')],
  examples: [{ owner: 'imagile', project: '3' }, { owner: 'imagile', repo: 'unused', project: 3, limit: 1, cursor: exampleGraphqlCursor() }],
  run: async (input, ctx) => inProject(ctx, input, FIELDS, 'fields', 'fields'),
});

interface Item {
  fieldValues?: { pageInfo?: { hasNextPage?: boolean }; nodes?: unknown[] };
  [key: string]: unknown;
}

export const projectItemsCommand = githubArea.command({
  path: ['github', 'projects', 'list-items'],
  description: "List a project's items (issues, pull requests, drafts) with their field values",
  toolDescription:
    "Lists a project's items: id, type (ISSUE, PULL_REQUEST, DRAFT_ISSUE), isArchived, the content (number, title, state, url and repository for an issue or PR; title for a draft) and fieldValues, each with its field's name and the value (text, number, date, a single-select name, or an iteration's title and dates). With limit, pass meta.page.nextCursor as cursor for the next page.",
  queryByPost: true,
  input: z.object({ project: projectNumber, ...pageFields('items') }),
  writes: false,
  options: [projectOption, ...pageOptions('items')],
  examples: [{ owner: 'imagile', project: '3' }, { owner: 'imagile', repo: 'unused', project: '3', limit: 1, cursor: exampleGraphqlCursor() }],
  run: async (input, ctx) => {
    const items = (await inProject(ctx, input, ITEMS, 'items', 'items')) as Item[];
    let cut = 0;
    const flat = items.map(({ fieldValues, ...item }) => {
      if (fieldValues?.pageInfo?.hasNextPage) cut++;
      return { ...item, fieldValues: fieldValues?.nodes ?? [] };
    });
    if (cut > 0) ctx.warn({ code: 'GITHUB_PROJECT_VALUES_TRUNCATED', message: `${cut} items have more than 100 field values; only the first 100 of each are shown.` });
    return flat;
  },
});

export const projectCommands = [listProjectsCommand, projectFieldsCommand, projectItemsCommand];
