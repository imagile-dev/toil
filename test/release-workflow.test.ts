import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

/**
 * One release-please run, two packages (#206, Packaging and release): toil at
 * the root, and Toil UI in ui/. These hold the release config and the publish
 * jobs to that plan, so a later edit can't let a UI commit bump toil, publish
 * the UI before the toil it pins, or let the two publish steps drift apart.
 * Two forms, one stamp, and a test that the stamps match.
 */

const root = join(import.meta.dirname, '..');
const json = (file: string) => JSON.parse(readFileSync(join(root, file), 'utf8'));

interface Step {
  name?: string;
  run?: string;
  'working-directory'?: string;
}
interface Job {
  needs?: string | string[];
  if?: string;
  outputs?: Record<string, string>;
  steps: Step[];
}
const workflow = load(readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8')) as { jobs: Record<string, Job> };
const { jobs } = workflow;
const step = (job: string, name: string) => jobs[job]!.steps.find((s) => s.name === name);

describe('release-please', () => {
  const config = json('release-please-config.json');
  const manifest = json('.release-please-manifest.json');
  const toil = config.packages['.'];
  const ui = config.packages.ui;

  it('has toil and Toil UI, joined by the node-workspace plugin', () => {
    expect(Object.keys(config.packages)).toEqual(['.', 'ui']);
    expect(config.plugins).toEqual([{ type: 'node-workspace' }]);
    expect(Object.keys(manifest).sort()).toEqual(['.', 'ui']);
  });

  it("keeps UI commits out of toil's release, and toil's tag and committed bundle as they were", () => {
    expect(toil['exclude-paths']).toEqual(['ui']);
    expect(toil['include-component-in-tag']).toBe(false);
    expect(toil['extra-files']).toEqual([{ type: 'generic', path: 'dist/toil-lib.js' }]);
    expect(ui['extra-files']).toBeUndefined();
  });

  it('tags the UI toil-ui-v<version>, with the same alpha settings as toil', () => {
    expect(ui).toMatchObject({ 'release-type': 'node', 'package-name': '@imagile-dev/toil-ui', component: 'toil-ui', 'include-component-in-tag': true });
    for (const key of ['bump-minor-pre-major', 'initial-version', 'versioning', 'prerelease', 'prerelease-type', 'changelog-path']) expect(ui[key], key).toEqual(toil[key]);
  });

  it("names the packages each folder's package.json does", () => {
    expect(json('package.json').name).toBe(toil['package-name']);
    expect(json('ui/package.json').name).toBe(ui['package-name']);
    expect(json('package.json').workspaces).toEqual(['ui']);
  });
});

describe('the publish jobs', () => {
  it('reads the UI outputs release-please prefixes with its path', () => {
    expect(jobs['release-please']!.outputs).toMatchObject({
      release_created: '${{ steps.rp.outputs.release_created }}',
      ui_release_created: "${{ steps.rp.outputs['ui--release_created'] }}",
      ui_tag_name: "${{ steps.rp.outputs['ui--tag_name'] }}",
      ui_version: "${{ steps.rp.outputs['ui--version'] }}",
    });
  });

  it("publishes the UI after toil, when toil had nothing to release, and never after toil's publish failed", () => {
    expect(jobs['publish-toil']!.needs).toBe('release-please');
    expect(jobs['publish-ui']!.needs).toEqual(['release-please', 'publish-toil']);
    const gate = jobs['publish-ui']!.if!.replace(/\s+/g, ' ');
    expect(gate).toContain('!cancelled()');
    expect(gate).toContain("needs.release-please.outputs.ui_release_created == 'true'");
    expect(gate).toContain("(needs.publish-toil.result == 'success' || needs.publish-toil.result == 'skipped')");
  });

  it('gates both on TOIL_RELEASES, through the release-please job', () => {
    expect(jobs['release-please']!.if).toBe("vars.TOIL_RELEASES == 'on'");
    expect(jobs['publish-ui']!.if).toContain("needs.release-please.result == 'success'");
  });

  it("runs toil's publish script for the UI, word for word but the package name", () => {
    const toil = step('publish-toil', 'Publish to npm')!;
    const ui = step('publish-ui', 'Publish to npm')!;
    expect(ui['working-directory']).toBe('ui');
    expect(ui.run!.replaceAll('@imagile-dev/toil-ui', '@imagile-dev/toil')).toBe(toil.run);
    expect(ui.run).toContain('--provenance');
  });

  it('checks the UI before it publishes: its tests, its build, check:package and the two-tarball smoke', () => {
    const runs = jobs['publish-ui']!.steps.map((s) => s.run ?? '');
    const at = (cmd: string) => runs.findIndex((r) => r.includes(cmd));
    const publish = runs.findIndex((r) => r.includes('npm publish'));
    for (const cmd of ['npm view "@imagile-dev/toil@$PIN"', 'npm test -w ui', 'npm run build -w ui', 'npm run check:package -w ui', 'npm run smoke -w ui']) {
      expect(at(cmd), cmd).toBeGreaterThan(-1);
      expect(at(cmd), cmd).toBeLessThan(publish);
    }
  });
});

describe('the lockfile after a release (#299)', () => {
  const job = jobs.lockfile!;
  const runs = job.steps.map((s) => s.run ?? '');
  const ci = load(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')) as { jobs: { gate: { steps: Array<Step & { if?: string }> } } };

  it('runs once toil is on npm, and never before', () => {
    expect(job.needs).toEqual(['release-please', 'publish-toil']);
    expect(job.if).toBe("needs.publish-toil.result == 'success'");
    const served = runs.findIndex((r) => r.includes('npm view "@imagile-dev/toil@$PIN"'));
    expect(served).toBeGreaterThan(-1);
    expect(served).toBeLessThan(runs.findIndex((r) => r.includes('--package-lock-only')));
  });

  it("points the entry at the published toil, proves it with npm ci and check:lockfile, and opens a PR with package-lock.json alone", () => {
    const fix = runs.find((r) => r.includes('--package-lock-only'))!;
    expect(fix).toContain('npm install --package-lock-only --ignore-scripts --no-audit --no-fund "@imagile-dev/toil@$PIN" -w ui --save-exact');
    expect(fix.indexOf('npm ci --ignore-scripts')).toBeLessThan(fix.indexOf('npm run check:lockfile -w ui'));
    const pr = step('lockfile', 'Open the lockfile PR')!.run!;
    expect(pr).toContain('git add package-lock.json\n');
    expect(pr).not.toMatch(/git add (-A|\.|--all)/);
    expect(pr).toContain('gh pr create --base main');
    expect(pr).toContain('git commit -m "chore(deps):');
  });

  it("is held by CI's check:lockfile on every PR but the release PR", () => {
    const check = ci.jobs.gate.steps.find((s) => s.run === 'npm run check:lockfile -w ui')!;
    expect(check.if).toBe("${{ !startsWith(github.head_ref, 'release-please--') }}");
  });
});
