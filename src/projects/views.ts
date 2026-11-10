import { z } from 'zod';
import { defineConfigCommand, type AnyCommand } from '../core/command.js';
import { ToilError } from '../core/errors.js';
import { CHARTS, MAX_PINS, MAX_TITLE, MAX_TOP, MAX_VIEWS, VIEW_NAME, readSavedView, viewToSpec, type SavedView } from '../core/insights/index.js';
import { VIEWS_REFUSED } from '../core/toil-project.js';
import { access, saved } from './build.js';
import { checkDay, checkDimension, checkFilters, checkMeasure, flagsFor } from './pivot.js';

/**
 * `toil projects view set | show | list | remove`: the pivots a team keeps in
 * its toil project (`views.<name>`), so everyone opens the same chart. A view
 * holds a measure, a split, filters and a period: no connection, host, secret
 * or `writes`, so an agent may save one over MCP. Removing one is a delete,
 * which a person does on the CLI. Like every toil project edit, `set` refuses
 * to change a view that is already there unless `--replace` says to. A saved
 * view is the only kind of chart that survives the meeting that asked for it.
 */

const toilProjectArg = { name: 'toil-project', field: 'toilProject', description: 'The toil project: a name, or the path to a toil project file' };
const nameArg = { name: 'name', field: 'name', description: 'The view name: lowercase letters, digits and hyphens, e.g. release-mix' };
const toilProjectField = z.string().min(1).describe('The toil project: a name, or the path to a toil project file');
const nameField = z.string().min(1).describe('The view name: lowercase letters, digits and hyphens, starting with a letter (at most 41 characters), e.g. release-mix');

function checkName(name: string): void {
  if (!VIEW_NAME.test(name)) throw new ToilError('INVALID_INPUT', `"${name}" isn't a view name.`, { fix: 'Use lowercase letters, digits and hyphens, starting with a letter, at most 41 characters, e.g. release-mix.' });
  if (VIEWS_REFUSED.includes(name)) throw new ToilError('INVALID_INPUT', `"${name}" can't be a view name: toil reads that key as a part of an area's section.`, { fix: 'Pick another name, e.g. release-mix.' });
}

const summary = (name: string, v: SavedView) => ({
  name,
  title: v.title ?? null,
  measure: v.measure,
  split: v.split ?? null,
  across: v.across ?? null,
  where: v.where?.length ?? 0,
  chart: v.chart ?? null,
});

function noView(project: string, name: string, views: Record<string, SavedView> | undefined): ToilError {
  const names = Object.keys(views ?? {});
  return new ToilError('INVALID_INPUT', `Toil project ${project} has no view named "${name}".`, { fix: names.length ? `It has: ${names.join(', ')}.` : 'It has none. Save one with toil projects view set.' });
}

export function toilProjectViewCommands(): AnyCommand[] {
  const set = defineConfigCommand({
    path: ['projects', 'view', 'set'],
    description: 'Save a pivot as a named view in a toil project, so everyone opens the same chart',
    toolDescription:
      "Saves a view in a toil project's views key: measure (items, estimate, days, throughput, cycleTime, wip or aging; default items), split and across (dimensions, e.g. category, release, resolved:week), where (filters, each \"<dimension> = a, b\" or \"<dimension> != a\"), from and to (days, YYYY-MM-DD), share, top, pin, includeParents, and title and chart (columns, bars, area, line, heatmap or table) for Toil UI. The whole view is replaced by what you pass. Every part is checked before the file is written. A view holds no connection, host, secret or writes. Run it with projects_pivot (view). A view that already exists is refused unless replace is set (the same content is accepted, and changes nothing). A local write: no allowWrite. Removing a view is a delete: a person does that on the CLI.",
    input: z.object({
      toilProject: toilProjectField,
      name: nameField,
      measure: z.string().min(1).optional().describe('What to count (default items)'),
      split: z.string().min(1).optional().describe('The rows: a dimension'),
      across: z.string().min(1).optional().describe('The columns: a dimension'),
      where: z.array(z.string().min(1)).optional().describe('Filters, each "<dimension> = a, b" or "<dimension> != a"'),
      from: z.string().min(1).optional().describe('The first day of the period, YYYY-MM-DD'),
      to: z.string().min(1).optional().describe('The last day of the period, YYYY-MM-DD'),
      share: z.boolean().optional().describe("Add each cell's share of its column's total"),
      top: z.number().int().min(0).max(MAX_TOP).optional().describe('How many split values keep a row before the rest fold into Other (0 keeps all)'),
      pin: z.array(z.string().min(1)).optional().describe(`Split values, by label, that always keep a row (at most ${MAX_PINS})`),
      includeParents: z.boolean().optional().describe('Count parent items too when splitting by a parent dimension'),
      title: z.string().min(1).optional().describe(`A title for Toil UI, one line of at most ${MAX_TITLE} characters`),
      chart: z.enum(CHARTS).optional().describe('The chart form Toil UI opens on; without one it follows the data'),
      replace: z.boolean().optional().describe('Change a view that already exists. Without it, a different view of that name is refused.'),
    }),
    writes: false,
    writesLocal: true,
    args: [toilProjectArg, nameArg],
    options: [
      ...flagsFor(),
      { flags: '--title <text>', field: 'title', description: 'A title for Toil UI, one line' },
      { flags: '--chart <form>', field: 'chart', description: `The chart form Toil UI opens on: ${CHARTS.join(', ')}` },
      { flags: '--replace', field: 'replace', description: 'Change a view that already exists, rather than refuse' },
    ],
    examples: [
      { toilProject: 'payments', name: 'release-mix', measure: 'items', split: 'release', share: true, top: 4 },
      {
        toilProject: 'payments', name: 'work-mix', measure: 'throughput', split: 'category', across: 'resolved:month', where: ['status != Cancelled'], from: '2026-07-01', to: '2026-09-30',
        share: true, top: 0, pin: ['Feature'], includeParents: true, title: 'Work mix by month', chart: 'columns', replace: true,
      },
    ],
    run: async (input, ctx) => {
      checkName(input.name);
      const { catalog } = access(ctx);
      const file = catalog.find(input.toilProject);
      const toilProject = structuredClone(file.toilProject);
      const existing = toilProject.views?.[input.name];
      const draft: Record<string, unknown> = { measure: input.measure !== undefined ? checkMeasure(input.measure) : 'items' };
      if (input.split !== undefined) draft.split = checkDimension(input.split, '--split');
      if (input.across !== undefined) draft.across = checkDimension(input.across, '--across');
      if (input.where !== undefined) draft.where = checkFilters(input.where);
      if (input.from !== undefined) draft.from = checkDay(input.from, '--from');
      if (input.to !== undefined) draft.to = checkDay(input.to, '--to');
      for (const key of ['share', 'top', 'pin', 'includeParents', 'title', 'chart'] as const) if (input[key] !== undefined) draft[key] = input[key];
      // The one validator a view passes, here and when the file is next read.
      const read = readSavedView(draft, `views.${input.name}`);
      if (!read.view) throw new ToilError('INVALID_INPUT', read.problems.join(' '), { fix: 'Fix what is named above and run it again.' });
      const view = read.view;
      const same = existing !== undefined && JSON.stringify(existing) === JSON.stringify(view);
      if (existing !== undefined && !same && !input.replace) {
        throw new ToilError('INVALID_INPUT', `Toil project ${toilProject.name}'s view ${input.name} is already set.`, { fix: 'Pass --replace to change it, or pick another name.' });
      }
      if (existing === undefined && Object.keys(toilProject.views ?? {}).length >= MAX_VIEWS) {
        throw new ToilError('INVALID_INPUT', `Toil project ${toilProject.name} already keeps ${MAX_VIEWS} views, the most.`, { fix: 'Remove one with toil projects view remove first.' });
      }
      toilProject.views = { ...(toilProject.views ?? {}), [input.name]: view };
      return saved(ctx, catalog, file, toilProject, !same, { view: { name: input.name, ...view } });
    },
  });

  const show = defineConfigCommand({
    path: ['projects', 'view', 'show'],
    description: 'Show one saved view of a toil project, and the pivot it runs',
    toolDescription:
      'Shows one saved view of a toil project: { toilProject, name, view (as saved), pivot (the PivotSpec it runs, without title and chart), command (the line that runs it) }. Run it with projects_pivot (view). Reads local files only.',
    input: z.object({ toilProject: toilProjectField, name: nameField }),
    writes: false,
    writesLocal: false,
    args: [toilProjectArg, nameArg],
    examples: [{ toilProject: 'payments', name: 'release-mix' }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const file = catalog.find(input.toilProject);
      const view = file.toilProject.views?.[input.name];
      if (!view) throw noView(file.toilProject.name, input.name, file.toilProject.views);
      return { toilProject: file.toilProject.name, name: input.name, view, pivot: viewToSpec(view), command: `toil projects pivot ${file.toilProject.name} --view ${input.name}` };
    },
  });

  const list = defineConfigCommand({
    path: ['projects', 'view', 'list'],
    description: "List a toil project's saved views",
    toolDescription: "Lists a toil project's saved views: { toilProject, views [{ name, title, measure, split, across, where (how many filters), chart }] }. Show one with projects_view_show. Reads local files only.",
    input: z.object({ toilProject: toilProjectField }),
    writes: false,
    writesLocal: false,
    args: [toilProjectArg],
    examples: [{ toilProject: 'payments' }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const file = catalog.find(input.toilProject);
      return { toilProject: file.toilProject.name, views: Object.entries(file.toilProject.views ?? {}).map(([name, v]) => summary(name, v)) };
    },
  });

  const remove = defineConfigCommand({
    path: ['projects', 'view', 'remove'],
    description: 'Delete one saved view from a toil project',
    input: z.object({ toilProject: toilProjectField, name: nameField }),
    writes: false,
    writesLocal: true,
    // A delete is never an MCP tool (CLAUDE.md, Writes); a person removes a view.
    kind: 'cli-only',
    args: [toilProjectArg, nameArg],
    examples: [{ toilProject: 'payments', name: 'by-status' }],
    run: async (input, ctx) => {
      const { catalog } = access(ctx);
      const file = catalog.find(input.toilProject);
      const toilProject = structuredClone(file.toilProject);
      const removed = toilProject.views?.[input.name];
      if (!toilProject.views || !removed) throw noView(toilProject.name, input.name, toilProject.views);
      delete toilProject.views[input.name];
      if (Object.keys(toilProject.views).length === 0) delete toilProject.views;
      return saved(ctx, catalog, file, toilProject, true, { removed: { name: input.name, ...removed } });
    },
  });

  return [set, show, list, remove];
}
