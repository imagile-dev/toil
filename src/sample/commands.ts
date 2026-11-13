import { join } from 'node:path';
import { z } from 'zod';
import { defineCommand, type AnyCommand } from '../core/command.js';
import { ToilError } from '../core/errors.js';
import { sampleTeam, SAMPLE_NAME, type SampleTeam } from '../core/sample/team.js';

/**
 * `toil sample team`: a whole software team as sample data, so toil can be
 * tried on a fresh install with no connection and no sync. It prints one part
 * of the team, or writes the two files that drop it in (`--out`): the Open
 * Work Items to pipe into `classify run` and `projects brief`, and the toil
 * project file to import. It calls nobody and reads no config. The team is
 * generated from a day, never a clock, so the sample is always this week's
 * work, which is more than can be said for the one in the demo environment.
 */

export const PARTS = ['owi', 'toil-project', 'jira', 'prs', 'facts'] as const;
type Part = (typeof PARTS)[number];

const PART = "Which part to print: owi (the default: Open Work Items and changes, what util owi map returns, to pipe into classify run and projects brief), toil-project (the toil project file's content), jira (what jira issue search --changelog prints), prs (what github pr get --include reviews,checks,commits,files prints) or facts (the figures the documentation quotes)";
const AS_OF = "The day the sample is current on, as an ISO time (default: now). Every date is an offset from that day's UTC date, so the same day gives the same sample";
const OUT = 'Write sample-team.owi.json and sample-team.project.json into this folder inside the workspace instead of printing a part. Refuses to replace a file that is there';

const OWI_FILE = `${SAMPLE_NAME}.owi.json`;
const PROJECT_FILE = `${SAMPLE_NAME}.project.json`;

const partOf = (team: SampleTeam, part: Part): unknown =>
  part === 'owi' ? team.owi : part === 'toil-project' ? team.toilProject : part === 'jira' ? team.jira : part === 'prs' ? team.prs : team.facts;

const json = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);

export function sampleCommands(): AnyCommand[] {
  const team = defineCommand({
    path: ['sample', 'team'],
    description: 'Print a sample software team (work items, pull requests, a toil project) to try toil with, or write it to a folder (local only)',
    toolDescription:
      "Generates a sample software team, a web shop's two teams and an AI agent over six sprints and three releases, as sample data for trying toil with no connection and no sync. It asks no service and reads no config. With no part it returns the Open Work Items and changes, { owi, count, items, changes, histories, unmapped, skipped }, in the shape util owi map returns (without its verified), so it pipes straight into classify run and projects brief. part picks another view: toil-project (the toil project file's content, named sample-team), jira (jira issue search --changelog's data), prs (github pr get --include reviews,checks,commits,files, one per pull request) or facts (the counts, sprints, releases and classification the documentation quotes). asOf names the day the sample is current on (an ISO time, default now); every date is an offset from it and the same asOf gives the same bytes. out writes sample-team.owi.json and sample-team.project.json into a new folder in the workspace and returns their paths and the facts; it never replaces a file. Import the project file with projects import to use it by name.",
    input: z.object({
      asOf: z.string().min(1).optional().describe(AS_OF),
      part: z.enum(PARTS).optional().describe(PART),
      out: z.string().min(1).optional().describe(OUT),
    }),
    writes: false,
    writesLocalWhen: (input) => input.out !== undefined,
    options: [
      { flags: '--as-of <time>', field: 'asOf', description: AS_OF },
      { flags: '--part <part>', field: 'part', description: PART },
      { flags: '--out <dir>', field: 'out', description: OUT },
    ],
    examples: [{ asOf: '2026-11-10T08:00:00Z' }, { asOf: '2026-11-10T08:00:00Z', part: 'facts' }, { asOf: '2026-11-10T08:00:00Z', out: 'sample' }],
    run: async (input, ctx) => {
      const asOf = input.asOf ?? new Date().toISOString();
      if (!Number.isFinite(Date.parse(asOf))) {
        throw new ToilError('INVALID_INPUT', `"${asOf}" isn't a date-time.`, { fix: 'Pass an ISO time, for example --as-of 2026-11-10T08:00:00Z, or leave it out for now.' });
      }
      if (input.out !== undefined && input.part !== undefined) {
        throw new ToilError('INVALID_INPUT', '--out writes both files, so it takes no --part.', { fix: 'Pass --out <dir> to write the files, or --part <part> to print one.' });
      }
      const sample = sampleTeam(asOf);
      if (input.out === undefined) return partOf(sample, input.part ?? 'owi');

      // Both targets are checked before either is written, so a refusal leaves the folder as it was.
      const targets = [join(input.out, OWI_FILE), join(input.out, PROJECT_FILE)];
      const present = targets.filter((target) => ctx.files.exists(target));
      if (present.length > 0) {
        throw new ToilError('INVALID_INPUT', `${present.map((p) => `"${p.replace(/\\/g, '/')}"`).join(' and ')} already exists. Nothing was written.`, {
          fix: 'Write to another folder, or delete the files first: toil never overwrites a file.',
        });
      }
      const owi = ctx.files.writeBytes(targets[0]!, json(sample.owi));
      const toilProject = ctx.files.writeBytes(targets[1]!, json(sample.toilProject));
      return { asOf: sample.asOf, owi, toilProject, facts: sample.facts };
    },
  });
  return [team];
}
