// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowed, npmCli, packageProblems, REQUIRED } from '../scripts/package-rules.mjs';

/**
 * What `npm pack` would put in @imagile-dev/toil-ui's tarball, on every test
 * run, built or not: nothing outside the allowlist (no source, tests, fixtures
 * or config), and a package.json that installs only toil, pinned to this
 * checkout's, and runs no script. scripts/check-package.mjs checks the same
 * rules after a build, plus that the required files are there and what the
 * server bundle imports.
 */

const ui = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(path, 'utf8');
const pkg = JSON.parse(read(join(ui, 'package.json')));
const root = JSON.parse(read(join(ui, '..', 'package.json')));

function packed(): string[] {
  const out = execFileSync(process.execPath, [npmCli(), 'pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: ui, encoding: 'utf8' });
  return (JSON.parse(out) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map((f) => f.path.replace(/\\/g, '/'));
}

describe('the toil-ui tarball', () => {
  it('holds only the server, the built app, package.json, README.md, LICENSE and NOTICE', () => {
    const files = packed();
    expect(files.filter((f) => !allowed(f))).toEqual([]);
    for (const f of ['package.json', 'README.md', 'LICENSE', 'NOTICE']) expect(files).toContain(f);
  }, 60_000);

  it('allows the files it must and refuses the ones it must not', () => {
    for (const f of REQUIRED) expect(allowed(f), f).toBe(true);
    expect(allowed('dist/app/assets/index-C6qRDsvA.js')).toBe(true);
    for (const f of ['src/App.tsx', 'server/main.ts', 'test/server.test.ts', 'dist/preview/index.html', 'dist/metafile-server.json', 'dist/app/assets/x.node', 'dist/app/assets/../../src/x.js', 'vite.config.ts', 'node_modules/react/index.js']) expect(allowed(f), f).toBe(false);
  });
});

describe("toil-ui's package.json", () => {
  it('installs toil alone, pinned exactly to this checkout, and runs no install script', () => {
    expect(packageProblems(pkg, root.version)).toEqual([]);
  });

  it('is refused when it would install more, pin loosely, or run a script', () => {
    expect(packageProblems({ ...pkg, dependencies: { '@imagile-dev/toil': `^${root.version}` } }, root.version).join()).toContain('pinned exactly');
    expect(packageProblems({ ...pkg, dependencies: { ...pkg.dependencies, react: '19.3.0' } }, root.version).join()).toContain('@imagile-dev/toil alone');
    expect(packageProblems({ ...pkg, scripts: { ...pkg.scripts, postinstall: 'node x.js' } }, root.version).join()).toContain('postinstall');
    expect(packageProblems({ ...pkg, peerDependencies: { '@imagile-dev/agent': '1.0.0' } }, root.version).join()).toContain('must be optional');
    expect(packageProblems({ ...pkg, private: true }, root.version).join()).toContain('private');
  });

  it('ships the same licence as toil, and its own NOTICE for what the app bundles', () => {
    expect(read(join(ui, 'LICENSE'))).toBe(read(join(ui, '..', 'LICENSE')));
    const notice = read(join(ui, 'NOTICE'));
    for (const name of ['React', 'IBM Plex Sans', 'Source Serif 4', 'Fira Code', 'SIL OPEN FONT LICENSE']) expect(notice).toContain(name);
  });

  it('keeps every bundled front-end package a dev dependency', () => {
    for (const dep of ['react', 'react-dom', 'vite', '@fontsource/ibm-plex-sans']) expect(pkg.devDependencies[dep], dep).toBeDefined();
  });
});
