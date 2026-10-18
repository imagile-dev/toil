import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { execute } from '../src/core/run.js';
import type { Finding, ScanData } from '../src/areas/util/secrets/scan.js';
import { secretsScanCommand } from '../src/areas/util/secrets.js';
import { createNodeContext } from '../src/node-context.js';

/**
 * `util secrets scan --diff` against a real repository and the real git, with
 * the workspace reached through a link, which is where a path comparison and
 * git's own answer part company. Kept out of src/areas, where nothing may
 * spawn a process; here, git is run only to set the scene. A junction stands
 * in for a symlink on Windows, where it needs no privilege, so no platform is
 * skipped.
 */

const at = (f: Finding) => `${f.file ?? '-'}:${f.line}:${f.column}`;

it('with the workspace reached through a symlink, git still places it inside the repository, and the warning holds (real git)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'toil-secrets-link-'));
  try {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'work'), { recursive: true });
    mkdirSync(join(repo, 'other'), { recursive: true });
    writeFileSync(join(repo, 'work', 'a.env'), 'password=Pl4ntedPassw0rd\n');
    writeFileSync(join(repo, 'other', 'b.env'), 'password=Pl4ntedOtherPw0rd\n');
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    git('init', '-q');
    git('add', '.');
    // A junction needs no privilege on Windows; elsewhere it's an ordinary symlink.
    const link = join(root, 'link');
    symlinkSync(join(repo, 'work'), link, process.platform === 'win32' ? 'junction' : 'dir');
    expect(realpathSync(link)).not.toBe(link);
    const ctx = createNodeContext({ globals: { workspace: link }, def: secretsScanCommand, signal: new AbortController().signal, env: process.env, cwd: link, home: root, areas: [], version: '0.0.0-test', stderr: () => {}, stdin: false });
    const envelope = await execute(secretsScanCommand, { diff: 'staged' }, ctx);
    expect(envelope.ok, JSON.stringify(envelope.error)).toBe(true);
    expect((envelope.data as ScanData).findings.map(at)).toEqual(['a.env:1:10']);
    expect(envelope.meta.warnings).toContainEqual({ code: 'SECRETS_DIFF_PARTIAL', message: expect.stringContaining('1 staged file is outside the workspace (work)') });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  // Several git processes on Windows: under 1 s alone, but 1.4 s to 4.1 s in a full run, against vitest's 5 s default.
}, 30_000);
