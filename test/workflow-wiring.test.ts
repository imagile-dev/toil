import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { OUTPUTS } from '../scripts/triage/steps.mjs';

/**
 * Static wiring for the workflows whose steps hand values to each other: every
 * `steps.<id>.outputs.<name>` a job references is a step in that job that writes
 * that name, and every `needs.<job>.outputs.<name>` is a job it needs that
 * declares it. Three review rounds of #226 found wiring a unit test couldn't see;
 * this is the test that can.
 */

const WORKFLOWS = ['.github/workflows/triage.yml', '.github/workflows/feedback-deploy.yml'];

/** Outputs of the actions these workflows use, from each action's action.yml at its pinned version. */
const ACTION_OUTPUTS: Record<string, string[]> = {
  'actions/create-github-app-token': ['token', 'installation-id', 'app-slug'],
};

interface Step {
  id?: string;
  uses?: string;
  run?: string;
}
interface Job {
  needs?: string | string[];
  outputs?: Record<string, string>;
  steps?: Step[];
}

/** What a step writes to $GITHUB_OUTPUT: a steps.mjs step's declared OUTPUTS, `name=` / `name<<` lines in a script, or an action's outputs. */
function produced(step: Step): string[] {
  if (step.uses) return ACTION_OUTPUTS[step.uses.split('@')[0]!] ?? [];
  const run = step.run ?? '';
  const named = /steps\.mjs\s+([\w-]+)/.exec(run);
  if (named) return (OUTPUTS as Record<string, string[]>)[named[1]!] ?? [];
  const names = new Set<string>();
  for (const line of run.split('\n')) {
    if (!line.includes('GITHUB_OUTPUT')) continue;
    for (const m of line.matchAll(/echo\s+"?([A-Za-z_][\w-]*)(?:=|<<)/g)) names.add(m[1]!);
  }
  return [...names];
}

for (const file of WORKFLOWS) {
  const text = readFileSync(join(process.cwd(), file), 'utf8');
  const workflow = load(text) as { jobs: Record<string, Job> };

  describe(`${file} wiring`, () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      const steps = job.steps ?? [];
      const byId = new Map(steps.filter((s) => s.id).map((s) => [s.id!, produced(s)]));
      const jobText = JSON.stringify(job);

      it(`${name}: every steps.<id>.outputs.<name> is written by that step`, () => {
        const missing = [...jobText.matchAll(/steps\.([\w-]+)\.outputs\.([\w-]+)/g)]
          .filter(([, id, output]) => !byId.get(id!)?.includes(output!))
          .map(([ref]) => ref);
        expect(missing).toEqual([]);
      });

      it(`${name}: every steps.<id>.outcome names a step`, () => {
        const missing = [...jobText.matchAll(/steps\.([\w-]+)\.(?:outcome|conclusion)/g)].filter(([, id]) => !byId.has(id!)).map(([ref]) => ref);
        expect(missing).toEqual([]);
      });

      it(`${name}: every needs.<job>.outputs.<name> is a declared output of a job it needs`, () => {
        const needs = [job.needs ?? []].flat();
        const missing = [...jobText.matchAll(/needs\.([\w-]+)\.(outputs\.([\w-]+)|result)/g)]
          .filter(([, other, , output]) => !needs.includes(other!) || (output !== undefined && !(output in (workflow.jobs[other!]?.outputs ?? {}))))
          .map(([ref]) => ref);
        expect(missing).toEqual([]);
      });
    }

    it('never reads $GITHUB_OUTPUT back: each step gets its own file, so a later step finds it empty', () => {
      const reads = text.split('\n').filter((line) => /(grep|cat|tail|head|<)[^\n]*\$\{?GITHUB_OUTPUT/.test(line) && !/>>\s*"?\$\{?GITHUB_OUTPUT/.test(line));
      expect(reads).toEqual([]);
    });
  });
}

describe('the wiring check bites', () => {
  it('finds an output a step never writes', () => {
    expect(produced({ run: 'node scripts/triage/steps.mjs select' })).toEqual(['issues']);
    expect(produced({ run: 'echo "app=$(jq -r .x f)" >> "$GITHUB_OUTPUT"' })).toEqual(['app']);
    expect(produced({ run: 'echo "app=1"' })).toEqual([]);
    expect(produced({ uses: 'actions/create-github-app-token@abc' })).toContain('token');
  });
});
