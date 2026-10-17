import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGitConfig } from './git-config.js';
import { parseBitbucketRemote, parseGitHubRemote } from './git-remote.js';
import { findGitRepo, readGitBranch, readGitContext, readGitRemotes } from './git-repo.js';
import { findGit } from './git.js';

// Repositories laid out by hand, so the pure-JS reader is tested where no git
// exists, and checked against real git where one does. Two sources of truth,
// reconciled quarterly; here, on every run.
const dirs: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const temp = () => {
  const d = realpathSync.native(mkdtempSync(join(tmpdir(), 'toil-repo-')));
  dirs.push(d);
  return d;
};
const put = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};
const fwd = (p: string) => p.replace(/\\/g, '/');
const SHA = 'a'.repeat(40);

/** A repository written by hand, the way git lays one out, so no git is needed to build it. */
function handRepo(config: string, head = 'ref: refs/heads/main\n') {
  const root = temp();
  const home = join(root, 'home');
  const work = join(root, 'work');
  put(join(work, '.git', 'HEAD'), head);
  put(join(work, '.git', 'refs', 'heads', 'main'), `${SHA}\n`);
  put(join(work, '.git', 'config'), config);
  mkdirSync(join(work, 'src', 'deep'), { recursive: true });
  mkdirSync(home, { recursive: true });
  return { root, home, work };
}

describe('readGitContext, with no git anywhere', () => {
  it('finds the root from a subfolder, the branch, and the fetch URLs sorted as git remote -v sorts them', () => {
    const { home, work } = handRepo(`[remote "zeta"]\n\turl = https://bitbucket.imagile.dev/scm/PROJ/z.git\n[remote "Upper"]\n\turl = git@github.com:imagile/u.git\n[remote "alpha"]\n\turl = git@github.com:imagile/a.git\n\turl = https://second.imagile.dev/push-only.git\n`);
    expect(readGitContext(join(work, 'src', 'deep'), { home })).toEqual({
      root: fwd(work),
      branch: 'main',
      remotes: ['git@github.com:imagile/u.git', 'git@github.com:imagile/a.git', 'https://bitbucket.imagile.dev/scm/PROJ/z.git'],
    });
  });

  it('gives --repo and --owner from the remote with PATH emptied, since nothing is spawned', () => {
    vi.stubEnv('PATH', '');
    vi.stubEnv('Path', '');
    const { home, work } = handRepo(`[remote "origin"]\n\turl = https://bitbucket.imagile.dev/scm/PROJ/widgets.git\n[remote "gh"]\n\turl = git@github.com:imagile/widgets.git\n`);
    expect(findGit({ env: process.env }).found).toBeUndefined();
    const ctx = readGitContext(work, { home })!;
    expect(ctx.remotes.map((u) => parseBitbucketRemote(u, 'https://bitbucket.imagile.dev')).find(Boolean)).toEqual({ project: 'PROJ', repo: 'widgets' });
    expect(ctx.remotes.map((u) => parseGitHubRemote(u, undefined)).find(Boolean)).toEqual({ owner: 'imagile', repo: 'widgets' });
  });

  it('applies the longest insteadOf, clears a remote on an empty url, and leaves out a remote with only a pushurl', () => {
    const { home, work } = handRepo(
      `[remote "a"]\n\turl = short:imagile/x\n[remote "b"]\n\turl = https://old.imagile.dev/x\n\turl =\n[remote "c"]\n\tpushurl = https://ghe.imagile.dev/p\n[url "https://github.com/"]\n\tinsteadOf = short:\n[url "ssh://git@github.com/"]\n\tinsteadOf = short:imagile\n[url "https://push.imagile.dev/"]\n\tpushInsteadOf = short:\n`,
    );
    expect(readGitContext(work, { home })!.remotes).toEqual(['ssh://git@github.com//x']);
  });

  it('cuts a URL at its first space, as the predecessor did splitting git remote -v (suspected bug, pinned)', () => {
    const { home, work } = handRepo('[remote "local"]\n\turl = "C:/My Repos/widgets"\n');
    expect(readGitContext(work, { home })!.remotes).toEqual(['C:/My']);
  });

  it('reports a detached HEAD as HEAD, a branch with no commits as unknown, and a packed branch by name', () => {
    expect(readGitContext(handRepo('', `${SHA}\n`).work, { home: tmpdir() })!.branch).toBe('HEAD');
    expect(readGitContext(handRepo('', 'ref: refs/heads/new\n').work, { home: tmpdir() })!.branch).toBe('unknown');
    const packed = handRepo('', 'ref: refs/heads/release/1.0\n');
    put(join(packed.work, '.git', 'packed-refs'), `# pack-refs with: peeled fully-peeled sorted\n${SHA} refs/heads/release/1.0\n`);
    expect(readGitContext(packed.work, { home: packed.home })!.branch).toBe('release/1.0');
  });

  it('follows include and includeIf (gitdir, gitdir/i, onbranch) in place, and reads the global config first', () => {
    const { home, work, root } = handRepo('');
    put(
      join(work, '.git', 'config'),
      `[include]
	path = extra.inc
[includeIf "gitdir:${fwd(work)}/"]
	path = ${fwd(join(root, 'by-dir.inc'))}
[includeIf "gitdir/i:${fwd(work).toUpperCase()}/"]
	path = ${fwd(join(root, 'by-dir-i.inc'))}
[includeIf "gitdir:${fwd(work)}"]
	path = ${fwd(join(root, 'never.inc'))}
[includeIf "onbranch:ma*"]
	path = ${fwd(join(root, 'by-branch.inc'))}
[includeIf "onbranch:other"]
	path = ${fwd(join(root, 'never.inc'))}
[includeIf "hasconfig:remote.*.url:https://**"]
	path = ${fwd(join(root, 'never.inc'))}
`,
    );
    put(join(work, '.git', 'extra.inc'), '[remote "inc"]\n\turl = https://bitbucket.imagile.dev/scm/P/inc.git\n');
    put(join(root, 'by-dir.inc'), '[remote "dir"]\n\turl = https://bitbucket.imagile.dev/scm/P/dir.git\n');
    put(join(root, 'by-dir-i.inc'), '[remote "diri"]\n\turl = https://bitbucket.imagile.dev/scm/P/diri.git\n');
    put(join(root, 'by-branch.inc'), '[remote "branch"]\n\turl = https://bitbucket.imagile.dev/scm/P/branch.git\n');
    put(join(root, 'never.inc'), '[remote "never"]\n\turl = https://bitbucket.imagile.dev/scm/P/never.git\n');
    put(join(home, '.gitconfig'), '[url "https://bitbucket.imagile.dev/scm/"]\n\tinsteadOf = bb:\n[remote "global"]\n\turl = bb:P/global.git\n');
    const remotes = readGitContext(work, { home })!.remotes;
    expect(remotes).toEqual(['https://bitbucket.imagile.dev/scm/P/branch.git', 'https://bitbucket.imagile.dev/scm/P/dir.git', 'https://bitbucket.imagile.dev/scm/P/diri.git', 'https://bitbucket.imagile.dev/scm/P/global.git', 'https://bitbucket.imagile.dev/scm/P/inc.git']);
  });

  it("skips an include naming toil's own files or /proc, with a warning", () => {
    const { home, work, root } = handRepo('');
    put(join(home, '.toil', 'config.json'), '[remote "leak"]\n\turl = https://bitbucket.imagile.dev/scm/P/leak.git\n');
    const custom = join(root, 'custom-config.json');
    put(custom, '[remote "leak2"]\n\turl = https://bitbucket.imagile.dev/scm/P/leak2.git\n');
    put(
      join(work, '.git', 'config'),
      `[include]
	path = ${fwd(join(home, '.toil', 'config.json'))}
[include]
	path = ${fwd(custom)}
[include]
	path = /proc/self/environ
[remote "ok"]
	url = https://bitbucket.imagile.dev/scm/P/ok.git
`,
    );
    const warnings: string[] = [];
    const repo = findGitRepo(work)!;
    expect(readGitRemotes(repo, { home, protect: [custom], warn: (w) => warnings.push(w.code) }).map((r) => r.name)).toEqual(['ok']);
    expect(warnings).toEqual(process.platform === 'win32' ? ['GIT_INCLUDE_REFUSED', 'GIT_INCLUDE_REFUSED'] : ['GIT_INCLUDE_REFUSED', 'GIT_INCLUDE_REFUSED', 'GIT_INCLUDE_REFUSED']);
  });

  it("refuses read-up into toil's own files: a gitdir: pointing there, and a global config there", () => {
    const { home, work, root } = handRepo('');
    put(join(home, '.toil', 'HEAD'), 'ref: refs/heads/main\n');
    const checkout = join(root, 'pointing');
    put(join(checkout, '.git'), `gitdir: ${join(home, '.toil')}\n`);
    expect(findGitRepo(checkout, { home })).toBeUndefined();
    put(join(home, '.toil', 'config.json'), '[remote "leak"]\n\turl = https://bitbucket.imagile.dev/scm/P/leak.git\n');
    const warnings: string[] = [];
    const remotes = readGitRemotes(findGitRepo(work, { home })!, { home, env: { GIT_CONFIG_GLOBAL: join(home, '.toil', 'config.json') }, warn: (w) => warnings.push(w.code) });
    expect(remotes).toEqual([]);
    expect(warnings).toEqual(['GIT_INCLUDE_REFUSED']);
  });

  it('reads XDG_CONFIG_HOME, or only GIT_CONFIG_GLOBAL when that is set', () => {
    const { home, work, root } = handRepo('');
    put(join(root, 'xdg', 'git', 'config'), '[remote "xdg"]\n\turl = https://bitbucket.imagile.dev/scm/P/xdg.git\n');
    put(join(root, 'only.gitconfig'), '[remote "only"]\n\turl = https://bitbucket.imagile.dev/scm/P/only.git\n');
    expect(readGitContext(work, { home, env: { XDG_CONFIG_HOME: join(root, 'xdg') } })!.remotes).toEqual(['https://bitbucket.imagile.dev/scm/P/xdg.git']);
    expect(readGitContext(work, { home, env: { XDG_CONFIG_HOME: join(root, 'xdg'), GIT_CONFIG_GLOBAL: join(root, 'only.gitconfig') } })!.remotes).toEqual(['https://bitbucket.imagile.dev/scm/P/only.git']);
  });

  it('reads a linked worktree: its own HEAD, the common config through commondir, and config.worktree when enabled', () => {
    const { home, work, root } = handRepo('[extensions]\n\tworktreeConfig = true\n[remote "origin"]\n\turl = https://bitbucket.imagile.dev/scm/P/main.git\n');
    const wtDir = join(work, '.git', 'worktrees', 'feature');
    put(join(wtDir, 'HEAD'), 'ref: refs/heads/feature\n');
    put(join(wtDir, 'commondir'), '../..\n');
    put(join(wtDir, 'config.worktree'), '[remote "wt"]\n\turl = https://bitbucket.imagile.dev/scm/P/wt.git\n');
    put(join(work, '.git', 'refs', 'heads', 'feature'), `${SHA}\n`);
    const checkout = join(root, 'feature-checkout');
    put(join(checkout, '.git'), `gitdir: ${wtDir}\n`);
    const repo = findGitRepo(join(checkout))!;
    expect(repo).toEqual({ root: fwd(checkout), gitDir: realpathSync.native(wtDir), commonDir: realpathSync.native(join(work, '.git')) });
    expect(readGitBranch(repo)).toBe('feature');
    expect(readGitRemotes(repo, { home }).map((r) => r.name)).toEqual(['origin', 'wt']);
  });

  it('finds nothing outside a repository or from inside a .git folder', () => {
    expect(findGitRepo(temp())).toBeUndefined();
    const { work } = handRepo('');
    expect(findGitRepo(join(work, '.git', 'refs'))).toBeUndefined();
  });
});

describe('parseGitConfig', () => {
  it('reads git config syntax: subsections, dotted sections, quotes, escapes, continuations, comments and bare keys', () => {
    const text = '[Core]\n\tBare\n\tName = "  spaced  " value # comment\n[remote "Origin"]\n  url = a\\\n b ; comment\n[remote.Lower]\n\turl = "x\\ty\\"z"\n[section] key = inline\n';
    expect(parseGitConfig(text).map(({ key, value }) => [key, value])).toEqual([
      ['core.bare', null],
      ['core.name', '  spaced   value'],
      ['remote.Origin.url', 'a b'],
      ['remote.lower.url', 'x\ty"z'],
      ['section.key', 'inline'],
    ]);
  });
});

// Tests that spawn the real git get 30 s, not vitest's 5 s default: each runs
// git several times, and on a loaded machine (CI, or a laptop mid-build) that
// has passed 5 s without anything being wrong.
const REAL_GIT_TIMEOUT_MS = 30_000;
const realGit = findGit({ env: process.env }).found;

describe.skipIf(!realGit)('matches real git (skipped where git is not installed)', () => {
  it('agrees with rev-parse --show-toplevel, --abbrev-ref HEAD and git remote -v, in a repo and a linked worktree', () => {
    const root = temp();
    const home = join(root, 'home');
    mkdirSync(home);
    const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(root, 'xdg'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig') };
    const git = (cwd: string, ...args: string[]) => execFileSync(realGit!, args, { cwd, env, encoding: 'utf8' }).trim();
    const work = join(root, 'work');
    mkdirSync(work);
    git(work, 'init', '-q', '-b', 'main');
    put(join(home, '.gitconfig'), `[url "https://bitbucket.imagile.dev/scm/"]\n\tinsteadOf = bb:\n[include]\n\tpath = ${fwd(join(root, 'inc'))}\n`);
    put(join(root, 'inc'), '[url "ssh://git@github.com/"]\n\tinsteadOf = gh:\n');
    git(work, 'remote', 'add', 'origin', 'bb:PROJ/widgets.git');
    git(work, 'remote', 'add', 'Gh', 'gh:imagile/widgets');
    git(work, 'remote', 'add', 'plain', 'https://ghe.imagile.dev/o/r.git');
    mkdirSync(join(work, 'sub'));

    const expected = (cwd: string) => ({
      root: git(cwd, 'rev-parse', '--show-toplevel'),
      branch: (() => {
        try {
          return execFileSync(realGit!, ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        } catch {
          return 'unknown';
        }
      })(),
      remotes: git(cwd, 'remote', '-v').split('\n').filter((l) => l.includes('(fetch)')).map((l) => l.split('\t')[1]!.split(' ')[0]!),
    });

    // Before the first commit, git can't name the branch.
    expect(readGitContext(join(work, 'sub'), { home, env })).toEqual(expected(join(work, 'sub')));
    git(work, '-c', 'user.name=toil', '-c', 'user.email=you@example.com', 'commit', '-q', '--allow-empty', '-m', 'first');
    expect(readGitContext(join(work, 'sub'), { home, env })).toEqual(expected(join(work, 'sub')));

    const linked = join(root, 'linked');
    git(work, 'worktree', 'add', '-q', '-b', 'feature', linked);
    expect(readGitContext(linked, { home, env })).toEqual(expected(linked));
    git(work, 'checkout', '-q', '--detach');
    expect(readGitContext(work, { home, env })).toEqual(expected(work));
    git(work, 'pack-refs', '--all');
    git(linked, 'checkout', '-q', 'feature');
    expect(readGitContext(linked, { home, env })).toEqual(expected(linked));
  }, REAL_GIT_TIMEOUT_MS);
});
