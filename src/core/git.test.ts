import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createGitRunner, findGit, GIT_SAFE_DIFF, GIT_SAFE_GLOBALS, GIT_SAFE_NETWORK, GIT_SUBCOMMANDS, gitArgv, gitEnv, gitNotFound, parseGitVersion } from './git.js';

// The spawner's safeguards, each pinned by a test, since a safeguard nobody
// checks is only a recommendation with a confident tone.
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), 'toil-git-'));
  dirs.push(d);
  return d;
};
const win = process.platform === 'win32';
const gitName = win ? 'git.exe' : 'git';

/** The real git's folder, for tests that run it; undefined where git isn't installed. */
// Tests that spawn the real git get 30 s, not vitest's 5 s default: each runs
// git several times, and on a loaded machine (CI, or a laptop mid-build) that
// has passed 5 s without anything being wrong.
const REAL_GIT_TIMEOUT_MS = 30_000;
const realGitDir = (() => {
  const found = findGit({ env: process.env });
  return found.found ? join(found.found, '..') : undefined;
})();

/** A file named git that isn't a program: on Windows any non-PE file; elsewhere a script whose interpreter doesn't exist. */
function plantBrokenGit(dir: string): string {
  const path = join(dir, gitName);
  writeFileSync(path, win ? 'not a program' : '#!/nonexistent/interpreter\n');
  if (!win) chmodSync(path, 0o755);
  return path;
}

describe('gitArgv: the safeguards are always there', () => {
  it('puts the global safeguards before every subcommand, and no-ext-diff/no-textconv after every one that diffs', () => {
    for (const subcommand of GIT_SUBCOMMANDS) {
      const argv = gitArgv({ subcommand });
      expect(argv.slice(0, GIT_SAFE_GLOBALS.length), subcommand).toEqual([...GIT_SAFE_GLOBALS]);
      // clone and pull talk to a remote, so they also get the transport and hook safeguards first.
      const network = ['clone', 'pull'].includes(subcommand) ? GIT_SAFE_NETWORK : [];
      expect(argv.slice(GIT_SAFE_GLOBALS.length, GIT_SAFE_GLOBALS.length + network.length), subcommand).toEqual([...network]);
      const at = GIT_SAFE_GLOBALS.length + network.length;
      expect(argv[at], subcommand).toBe(subcommand);
      const diffs = ['diff', 'log', 'show'].includes(subcommand);
      expect(argv.slice(at + 1, at + 1 + GIT_SAFE_DIFF.length), subcommand).toEqual(diffs ? [...GIT_SAFE_DIFF] : []);
    }
    expect(GIT_SAFE_NETWORK).toEqual(['-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always', '-c', 'protocol.file.allow=always', '-c', 'core.hooksPath=/dev/null', '-c', 'submodule.recurse=false']);
    expect(GIT_SAFE_GLOBALS).toEqual(['--no-pager', '-c', 'core.fsmonitor=', '-c', 'log.showSignature=false']);
    expect(GIT_SAFE_DIFF).toEqual(['--no-ext-diff', '--no-textconv']);
  });

  it('keeps them with options, revisions and paths, which go after --end-of-options and --', () => {
    expect(gitArgv({ subcommand: 'log', options: ['--format=%H'], revisions: ['main..feature'], paths: ['src/a.ts', '-weird-name'] })).toEqual([
      ...GIT_SAFE_GLOBALS, 'log', '--no-ext-diff', '--no-textconv', '--format=%H', '--end-of-options', 'main..feature', '--', 'src/a.ts', '-weird-name',
    ]);
    expect(gitArgv({ subcommand: 'status', options: ['--porcelain'], paths: ['x'] })).toEqual([...GIT_SAFE_GLOBALS, 'status', '--porcelain', '--', 'x']);
    // rev-parse only learnt --end-of-options in git 2.43; the leading-dash refusal covers it.
    expect(gitArgv({ subcommand: 'rev-parse', options: ['--verify'], revisions: ['main'] })).toEqual([...GIT_SAFE_GLOBALS, 'rev-parse', '--verify', 'main']);
  });

  it('refuses a revision that would read as a flag, and options that write files or run programs', () => {
    expect(() => gitArgv({ subcommand: 'log', revisions: ['--output=/tmp/x'] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => gitArgv({ subcommand: 'log', revisions: [''] })).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
    for (const option of ['--output=x', '--ext-diff', '--textconv', '--exec=sh', '--upload-pack=x', '-Oorder', 'not-a-flag']) {
      expect(() => gitArgv({ subcommand: 'diff', options: [option] }), option).toThrow(expect.objectContaining({ code: 'INTERNAL' }));
    }
    expect(() => gitArgv({ subcommand: 'push' as never })).toThrow(expect.objectContaining({ code: 'INTERNAL' }));
  });

  it('gives git only the allowlisted env, prompts and optional locks off, so no token (TOIL_*, GITHUB_TOKEN, SYSTEM_ACCESSTOKEN) reaches it', () => {
    const env = gitEnv({
      PATH: '/usr/bin', Path: 'C:/Windows', HOME: '/home/u', USERPROFILE: 'C:/Users/u', LANG: 'en_US.UTF-8', LC_ALL: 'C', TMPDIR: '/tmp', TEMP: 'C:/t', TMP: 'C:/t',
      SystemRoot: 'C:/Windows', COMSPEC: 'cmd', PATHEXT: '.EXE', APPDATA: 'a', LOCALAPPDATA: 'l', HOMEDRIVE: 'C:', HOMEPATH: '/Users/u', XDG_CONFIG_HOME: '/x', GIT_CONFIG_GLOBAL: '/g',
      TOIL_JIRA_API_TOKEN: 'secret', GITHUB_TOKEN: 'ghp_secret', SYSTEM_ACCESSTOKEN: 'ado-secret', GIT_ASKPASS: 'x', AWS_SECRET_ACCESS_KEY: 'k', GIT_TERMINAL_PROMPT: '1',
    });
    expect(env).toEqual({
      PATH: '/usr/bin', Path: 'C:/Windows', HOME: '/home/u', USERPROFILE: 'C:/Users/u', LANG: 'en_US.UTF-8', LC_ALL: 'C', TMPDIR: '/tmp', TEMP: 'C:/t', TMP: 'C:/t',
      SystemRoot: 'C:/Windows', COMSPEC: 'cmd', PATHEXT: '.EXE', APPDATA: 'a', LOCALAPPDATA: 'l', HOMEDRIVE: 'C:', HOMEPATH: '/Users/u', XDG_CONFIG_HOME: '/x', GIT_CONFIG_GLOBAL: '/g',
      GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0',
    });
    expect(JSON.stringify(env)).not.toMatch(/secret|GITHUB_TOKEN|SYSTEM_ACCESSTOKEN/);
  });

  it('passes the proxy only to a call that talks to a remote, and keeps Git Credential Manager from opening a window', () => {
    const env = { PATH: '/usr/bin', HTTPS_PROXY: 'http://proxy.imagile.dev:3128', no_proxy: 'localhost', GITHUB_TOKEN: 'ghp_secret' };
    expect(gitEnv(env, { subcommand: 'status' })).toEqual({ PATH: '/usr/bin', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
    expect(gitEnv(env, { subcommand: 'clone' })).toEqual({
      PATH: '/usr/bin', HTTPS_PROXY: 'http://proxy.imagile.dev:3128', no_proxy: 'localhost', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GCM_INTERACTIVE: 'never',
    });
  });

  it('hands secretConfig to git as GIT_CONFIG_COUNT entries in its environment, never in argv', () => {
    const call = { subcommand: 'pull' as const, secretConfig: [['http.https://bitbucket.imagile.dev/scm/ai/skills.git.extraHeader', 'Authorization: Basic c2VjcmV0'] as const] };
    expect(gitEnv({ PATH: '/usr/bin' }, call)).toMatchObject({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://bitbucket.imagile.dev/scm/ai/skills.git.extraHeader',
      GIT_CONFIG_VALUE_0: 'Authorization: Basic c2VjcmV0',
    });
    expect(gitArgv(call).join(' ')).not.toContain('c2VjcmV0');
    // An inherited GIT_CONFIG_COUNT is dropped with the rest of the caller's env.
    expect(gitEnv({ GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.sshCommand', GIT_CONFIG_VALUE_0: 'x' })).toEqual({ GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
  });

  it('reads the version git prints', () => {
    expect(parseGitVersion('git version 2.49.0.windows.1\n')).toEqual([2, 49]);
    expect(parseGitVersion('git version 2.30.2\n')).toEqual([2, 30]);
    expect(parseGitVersion('nonsense')).toBeUndefined();
  });
});

describe('findGit', () => {
  it('skips relative PATH entries and the working directory, so a planted git is never found', () => {
    const cwd = temp();
    plantBrokenGit(cwd);
    const search = findGit({ env: { PATH: ['.', '', 'bin', cwd].join(delimiter) }, exclude: [cwd] });
    expect(search.found).toBeUndefined();
    expect(search.skipped.map((s) => s.why)).toEqual(['relative', 'relative', 'relative', 'inside the working directory or workspace']);
  });

  it('skips folders inside the working directory too, such as the node_modules/.bin that npm run puts on PATH', () => {
    const cwd = temp();
    const bin = join(cwd, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    plantBrokenGit(bin);
    expect(findGit({ env: { PATH: bin }, exclude: [cwd] }).found).toBeUndefined();
  });

  it('still finds a git installed under home when the working directory is home, skipping only home itself', () => {
    const home = temp();
    const local = join(home, '.local', 'bin');
    mkdirSync(local, { recursive: true });
    const path = plantBrokenGit(local);
    plantBrokenGit(home);
    expect(findGit({ env: { PATH: [home, local].join(delimiter) }, exclude: [home], home }).found).toBe(path);
    // A project under home is still a checkout: its node_modules/.bin is skipped.
    const project = join(home, 'project');
    const bin = join(project, 'node_modules', '.bin');
    mkdirSync(bin, { recursive: true });
    plantBrokenGit(bin);
    expect(findGit({ env: { PATH: bin }, exclude: [project], home }).found).toBeUndefined();
  });

  it('finds git in an absolute PATH entry, in order', () => {
    const a = temp();
    const b = temp();
    const path = plantBrokenGit(b);
    expect(findGit({ env: { PATH: [a, b].join(delimiter) } }).found).toBe(path);
  });

  it.skipIf(win)('passes over a git that is not executable (POSIX only: Windows has no execute bit)', () => {
    const dir = temp();
    writeFileSync(join(dir, 'git'), '#!/bin/sh\n');
    chmodSync(join(dir, 'git'), 0o644);
    expect(findGit({ env: { PATH: dir } }).found).toBeUndefined();
  });

  it('passes over a folder named git', () => {
    const dir = temp();
    mkdirSync(join(dir, gitName));
    expect(findGit({ env: { PATH: dir } }).found).toBeUndefined();
  });

  it('on Windows reads Path in any case and only .exe and .com from PATHEXT', () => {
    const dir = temp();
    writeFileSync(join(dir, 'git.cmd'), '@echo off');
    writeFileSync(join(dir, 'git.bat'), '@echo off');
    expect(findGit({ env: { Path: dir, PATHEXT: '.BAT;.CMD' }, platform: 'win32' }).found).toBeUndefined();
    writeFileSync(join(dir, 'git.exe'), '');
    expect(findGit({ env: { Path: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' }, platform: 'win32' }).found).toBe(join(dir, 'git.exe'));
  });

  it('names the PATH it searched in the fix', () => {
    const err = gitNotFound('git status', { searched: ['/opt/a', '.'], skipped: [{ entry: '.', why: 'relative' }] });
    expect(err.code).toBe('GIT_NOT_FOUND');
    expect(err.message).toBe("git isn't on PATH, and toil git status needs it. Only commands that run git need it installed.");
    expect(err.fix).toContain('Install git (https://git-scm.com/downloads), or add the folder that holds it to PATH');
    expect(err.fix).toContain(`PATH searched: /opt/a${win ? ';' : delimiter}.`);
    expect(gitNotFound('x', { searched: ['/a', '/b'], skipped: [], platform: 'linux' }).fix).toContain('PATH searched: /a:/b.');
    expect(gitNotFound('x', { searched: ['C:/a', 'C:/b'], skipped: [], platform: 'win32' }).fix).toContain('PATH searched: C:/a;C:/b.');
    expect(err.fix).toContain('Skipped: . (relative).');
    expect(gitNotFound('x', { searched: [], skipped: [] }).fix).toContain('PATH searched: (empty).');
  });
});

describe('createGitRunner', () => {
  const runner = (env: NodeJS.ProcessEnv, workspace: string) => createGitRunner({ command: 'test git', env, workspace: () => workspace, exclude: [workspace] });

  it('rejects with GIT_NOT_FOUND, fast, when PATH is empty', async () => {
    const ws = temp();
    const started = Date.now();
    await expect(runner({ PATH: '' }, ws).run({ subcommand: 'version' })).rejects.toMatchObject({ code: 'GIT_NOT_FOUND', message: expect.stringContaining("git isn't on PATH, and toil test git needs it") });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never runs a git planted in the workspace, even with the workspace on PATH', async () => {
    const ws = temp();
    plantBrokenGit(ws);
    await expect(runner({ PATH: [ws, '.'].join(delimiter) }, ws).run({ subcommand: 'version' })).rejects.toMatchObject({ code: 'GIT_NOT_FOUND', message: expect.stringContaining("isn't on PATH") });
  });

  it('reports a git that exists but cannot run as GIT_NOT_FOUND, naming where it is', async () => {
    const ws = temp();
    const bin = temp();
    plantBrokenGit(bin);
    await expect(runner({ PATH: bin }, ws).run({ subcommand: 'version' })).rejects.toMatchObject({
      code: 'GIT_NOT_FOUND',
      message: expect.stringMatching(/^git at .+ could not be run \(.+\), and toil test git needs it\.$/),
      fix: expect.stringContaining('Reinstall git'),
    });
  });

  it('refuses before looking for git when there is no workspace', async () => {
    const r = createGitRunner({ command: 'x', env: { PATH: '' }, workspace: () => { throw new Error('no workspace'); }, exclude: [] });
    await expect(r.run({ subcommand: 'version' })).rejects.toThrow('no workspace');
  });

  it.skipIf(!realGitDir)('runs the real git with the safeguards (skipped where git is not installed)', async () => {
    const ws = temp();
    const result = await runner({ PATH: realGitDir! }, ws).run({ subcommand: 'version' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^git version /);
    const config = await runner({ PATH: realGitDir! }, ws).run({ subcommand: 'rev-parse', options: ['--is-inside-work-tree'] });
    expect(config.exitCode).not.toBe(0); // not a repository: git's own answer, passed back
  }, REAL_GIT_TIMEOUT_MS);

  it('refuses a cwd that is not absolute', async () => {
    const ws = temp();
    await expect(runner({ PATH: '' }, ws).run({ subcommand: 'pull', cwd: 'relative/clone' })).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it.skipIf(!realGitDir)('clones a local repository into a folder outside the workspace and pulls it there (skipped where git is not installed)', async () => {
    const ws = temp();
    const origin = temp();
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: origin });
    writeFileSync(join(origin, 'a.txt'), 'one\n');
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=you@example.com', 'add', '.'], { cwd: origin });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=you@example.com', 'commit', '-q', '-m', 'one'], { cwd: origin });
    const parent = temp();
    const clone = join(parent, 'clone');
    const git = runner({ PATH: realGitDir! }, ws);
    const cloned = await git.run({ subcommand: 'clone', options: ['--no-recurse-submodules'], paths: [origin, clone], cwd: parent });
    expect(cloned.exitCode, cloned.stderr).toBe(0);
    expect(existsSync(join(clone, 'a.txt'))).toBe(true);
    const pulled = await git.run({ subcommand: 'pull', options: ['--ff-only', '--no-rebase'], cwd: clone });
    expect(pulled.exitCode, pulled.stderr).toBe(0);
  }, REAL_GIT_TIMEOUT_MS);

  it.skipIf(!realGitDir)('refuses a transport that runs a program, such as ext:: (skipped where git is not installed)', async () => {
    const ws = temp();
    const parent = temp();
    const planted = join(parent, 'ran');
    const result = await runner({ PATH: realGitDir! }, ws).run({ subcommand: 'clone', paths: [`ext::sh -c touch% ${planted.replace(/\\/g, '/')}`, join(parent, 'clone')], cwd: parent });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/transport 'ext' not allowed/);
    expect(existsSync(planted)).toBe(false);
  }, REAL_GIT_TIMEOUT_MS);

  it.skipIf(!realGitDir)('stops git when the command is cancelled', async () => {
    const ws = temp();
    execFileSync('git', ['init', '-q'], { cwd: ws });
    const controller = new AbortController();
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(runner({ PATH: realGitDir! }, ws).run({ subcommand: 'status' }, controller.signal)).rejects.toBe(reason);
  }, REAL_GIT_TIMEOUT_MS);
});
