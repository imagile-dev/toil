import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLAIMED, QUEUED, claim, claimRank, gh, waiting, type LabelEvent } from '../scripts/triage/cap.mjs';
import { areaOf, check, parseRaw } from '../scripts/triage/changes.mjs';
import { areas, labels } from '../scripts/triage/labels.mjs';
import { parseTerms, redact } from '../scripts/triage/redact.mjs';

/**
 * The scripts .github/workflows/triage.yml runs around the triage agent:
 * redaction before it reads anything, the daily cap, and the path check that
 * decides whether its fix may become a pull request. None of this touches
 * the network: GitHub is a fake fetch.
 */

describe('redact', () => {
  const terms = parseTerms(['# fictional names only', 'acmebank', 'acme-int.net', 're:/initech[- ]?corp/i', 'org', 'jira', 'imagile.dev', 're:/(/'].join('\n'));

  it('refuses denylist entries that would match its own markers, and broken patterns', () => {
    expect(terms.words).toEqual(['acmebank']);
    expect(terms.domains).toEqual(['acme-int.net']);
    expect(terms.patterns).toHaveLength(1);
    expect(terms.invalid).toBe(4);
  });

  it.each([
    ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'token [redacted-secret]'],
    ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz', '[redacted-secret]'],
    ['Authorization: Bearer abc.def.ghi-jkl_mno', 'Authorization: Bearer [redacted-secret]'],
    ['TOIL_JIRA_TOKEN=ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz', 'TOIL_JIRA_TOKEN=[redacted-secret]'],
    ['{"apiToken": "s3cr3t-value"}', '{"apiToken": "[redacted-secret]"}'],
    ['clientSecret: hunter22', 'clientSecret: [redacted-secret]'],
    ['toil --token abcd1234 jira get', 'toil --token [redacted-secret] jira get'],
    ['connections set corp.apiToken abcd1234', 'connections set corp.apiToken [redacted-secret]'],
    ['https://jdoe:pa55word@bitbucket.imagile.dev/scm', 'https://[redacted-secret]@bitbucket.imagile.dev/scm'],
    ['-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----', '[redacted-secret]'],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop', '[redacted-secret]'],
  ])('removes the credential in %j', (input, output) => {
    expect(redact(input, terms)).toBe(output);
  });

  it('removes email addresses but keeps placeholders, GitHub noreply and git@ remotes', () => {
    expect(redact('mail jane.doe@acmebank.com or bob@mail.imagile.dev', terms)).toBe('mail [redacted-email] or [redacted-email]');
    expect(redact('you@example.com, 1+x@users.noreply.github.com, git@github.com:o/r.git', terms)).toBe('you@example.com, 1+x@users.noreply.github.com, git@github.com:o/r.git');
    expect(redact('git@git.acme-int.net:team/repo.git', terms)).toBe('[redacted-email]:team/repo.git');
  });

  it('replaces internal and denylisted hosts, keeping a known service name', () => {
    expect(redact('https://jira.acme-int.net/browse/X-1 and http://build7.corp:8080 and wiki.acmebank.local', terms)).toBe(
      'https://jira.imagile.dev/browse/X-1 and http://redacted.imagile.dev:8080 and redacted.imagile.dev',
    );
    expect(redact('https://jira.imagile.dev and https://github.com', terms)).toBe('https://jira.imagile.dev and https://github.com');
  });

  it('replaces private addresses only', () => {
    expect(redact('10.1.2.3 172.16.0.9 192.168.1.1 127.0.0.1 169.254.1.1 100.64.0.1 8.8.8.8 172.32.0.1 999.1.1.1', terms)).toBe(
      '[redacted-ip] [redacted-ip] [redacted-ip] [redacted-ip] [redacted-ip] [redacted-ip] 8.8.8.8 172.32.0.1 999.1.1.1',
    );
  });

  it('replaces denylisted words as whole words and patterns, in any case', () => {
    expect(redact('AcmeBank uses Initech Corp; acmebankcli stays', terms)).toBe('[org] uses [org]; acmebankcli stays');
  });

  it('is idempotent', () => {
    const once = redact('ghp_abcdefghijklmnopqrstuvwxyz0123456789 jane@acmebank.com https://jira.acme-int.net 10.0.0.1 AcmeBank password=hunter22', terms);
    expect(redact(once, terms)).toBe(once);
  });

  it('runs as a CLI: JSON in, JSON out, terms only from env', () => {
    const out = execFileSync(process.execPath, ['scripts/triage/redact.mjs'], {
      input: JSON.stringify({ title: 'AcmeBank jira', body: 'see 10.0.0.1' }),
      env: { ...process.env, REDACT_TERMS: 'acmebank' },
      encoding: 'utf8',
    });
    expect(JSON.parse(out)).toEqual({ title: '[org] jira', body: 'see [redacted-ip]', changed: true, invalidTerms: 0 });
  });
});

describe('the daily cap', () => {
  const ev = (id: number, issue: number, at: string, name = CLAIMED, event = 'labeled'): LabelEvent => ({ id, event, created_at: at, label: { name }, issue: { number: issue } });
  const today = '2026-10-18';

  it('ranks today\'s distinct claims by event id, ignoring other days, labels and unlabel events', () => {
    const events = [
      ev(9, 30, '2026-10-18T09:00:00Z'),
      ev(8, 31, '2026-10-18T08:00:00Z', CLAIMED, 'unlabeled'),
      ev(7, 31, '2026-10-18T08:00:00Z'),
      ev(6, 30, '2026-10-18T07:00:00Z'),
      ev(5, 29, '2026-10-18T06:00:00Z', 'bug'),
      ev(4, 28, '2026-10-17T23:59:59Z'),
    ];
    expect(claimRank(events, 30, today)).toBe(1);
    expect(claimRank(events, 31, today)).toBe(2);
    expect(claimRank(events, 28, today)).toBe(0);
    expect(claimRank(events, 29, today)).toBe(0);
  });

  it('picks waiting issues oldest first: queued, never picked up, or holding a dead claim', () => {
    const issue = (number: number, labels: string[], state = 'open') => ({ number, state, labels: labels.map((name) => ({ name })) });
    const list = [issue(9, ['from-terminal']), issue(3, [QUEUED, 'from-website']), issue(4, ['from-website', 'triaged']), issue(5, ['bug']), issue(6, ['from-website'], 'closed'), issue(7, [CLAIMED, 'from-website']), issue(8, ['from-website', 'denied'])];
    expect(waiting(list).map((i) => i.number)).toEqual([3, 7, 9]);
  });

  /** A fake GitHub holding one issue's labels and the repository's label events. */
  function fakeGitHub(issues: Record<number, string[]>, prior: LabelEvent[] = [], at = '2026-10-18T12:00:00Z') {
    const events = [...prior];
    let id = 100;
    const calls: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      const path = url.replace('https://api.github.com', '');
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      const issueMatch = /^\/repos\/o\/r\/issues\/(\d+)(\/labels(?:\/(.+))?)?$/.exec(path);
      if (method === 'GET' && path.startsWith('/repos/o/r/issues/events')) return Response.json([...events].sort((a, b) => b.id - a.id));
      if (issueMatch) {
        const n = Number(issueMatch[1]);
        if (method === 'GET') return Response.json({ number: n, state: 'open', labels: issues[n]!.map((name) => ({ name })) });
        if (method === 'POST') {
          for (const name of (JSON.parse(String(init!.body)) as { labels: string[] }).labels) {
            if (!issues[n]!.includes(name)) {
              issues[n]!.push(name);
              events.push({ id: ++id, event: 'labeled', created_at: at, label: { name }, issue: { number: n } });
            }
          }
          return Response.json([]);
        }
        if (method === 'DELETE') {
          const name = decodeURIComponent(issueMatch[3]!);
          issues[n] = issues[n]!.filter((l) => l !== name);
          events.push({ id: ++id, event: 'unlabeled', created_at: at, label: { name }, issue: { number: n } });
          return new Response(null, { status: 204 });
        }
      }
      throw new Error(`No route for ${method} ${path}`);
    }) as typeof fetch;
    return { fetcher, issues, calls };
  }

  it('lets the first four claims of the day run and queues the fifth', async () => {
    const prior = [1, 2, 3, 4].map((n, i) => ev(10 + i, n, '2026-10-18T0' + i + ':00:00Z'));
    const github = fakeGitHub({ 5: ['from-website'], 3: ['from-website', CLAIMED] }, prior);
    const options = { fetcher: github.fetcher, token: 't', now: new Date('2026-10-18T12:00:00Z') };
    expect(await claim('o/r', 5, 4, options)).toEqual({ run: false, reason: expect.stringContaining('queued') });
    expect(github.issues[5]).toEqual(['from-website', QUEUED]);
    expect(await claim('o/r', 3, 4, options)).toEqual({ run: true, reason: 'claim 3 of 4 today' });
  });

  it('renews a claim left from an earlier day, so it counts today', async () => {
    const github = fakeGitHub({ 7: ['from-website', CLAIMED] }, [ev(1, 7, '2026-10-17T10:00:00Z')]);
    const result = await claim('o/r', 7, 4, { fetcher: github.fetcher, token: 't', now: new Date('2026-10-18T12:00:00Z') });
    expect(result.run).toBe(true);
    expect(github.calls).toContain(`DELETE /repos/o/r/issues/7/labels/${CLAIMED}`);
  });

  it('retries GitHub on 5xx, 429 and network errors, and not on a 4xx', async () => {
    let n = 0;
    const flaky = (async () => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      if (n === 2) return new Response('', { status: 502 });
      if (n === 3) return new Response('', { status: 429 });
      return Response.json({ ok: true });
    }) as typeof fetch;
    expect(await gh('GET', '/x', undefined, { fetcher: flaky, token: 't', pause: 0, attempts: 4 })).toEqual({ ok: true });
    const refused = (async () => new Response('nope', { status: 403 })) as typeof fetch;
    await expect(gh('GET', '/x', undefined, { fetcher: refused, token: 't', pause: 0 })).rejects.toThrow('returned 403');
  });
});

describe('the path check', () => {
  const known = ['jira', 'jira-cloud', 'github'];

  it.each([
    ['src/areas/jira/commands.ts', 'jira'],
    ['src/areas/jira-cloud/index.ts', 'jira-cloud'],
    ['test/fixtures/jira.fixture.ts', 'jira'],
    ['skills/toil/github.md', 'github'],
    ['docs/divergences/jira.json', 'jira'],
    ['site/src/data/integrations/jira.json', 'jira'],
    ['site/src/data/commands/jira.json', 'jira'],
    ['site/src/data/settings/jira.json', 'jira'],
  ])('allows %s', (path, area) => {
    expect(areaOf(path, known)).toBe(area);
  });

  it.each([
    '.github/workflows/triage.yml', '.github/CODEOWNERS', 'src/core/execute.ts', 'src/registry.ts', 'functions/feedback/src/lib/handlers.ts', 'infra/main.bicep',
    'site/src/pages/feedback.astro', 'dist/toil.js', 'package.json', 'package-lock.json', 'scripts/triage/changes.mjs', 'CLAUDE.md',
    'src/areas/newthing/index.ts', 'src/areas/jira/../../core/x.ts', 'test/fixtures/jira.fixture.ts.bak', 'test/triage.test.ts',
  ])('refuses %s', (path) => {
    expect(areaOf(path, known)).toBeUndefined();
  });

  it('refuses a second area, a symlink, a submodule, and an empty change', () => {
    expect(check([{ path: 'src/areas/jira/a.ts', newMode: '100644' }, { path: 'skills/toil/github.md', newMode: '100644' }], known).refused).toEqual(['more than one area: github, jira']);
    expect(check([{ path: 'src/areas/jira/a.ts', newMode: '120000' }], known).ok).toBe(false);
    expect(check([{ path: 'src/areas/jira/sub', newMode: '160000' }], known).ok).toBe(false);
    expect(check([], known).refused).toEqual(['no changes']);
    expect(check([{ path: 'src/areas/jira/a.ts', newMode: '100644' }, { path: 'src/areas/jira/old.ts', newMode: '000000' }], known)).toEqual({ ok: true, area: 'jira', refused: [] });
  });

  it('reads git diff --raw -z from a real repository, so the parser matches what git writes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toil-triage-'));
    try {
      const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'core.autocrlf=false', ...args], { cwd: dir, encoding: 'utf8' });
      git('init', '-q', '-b', 'main');
      mkdirSync(join(dir, 'src', 'areas', 'jira'), { recursive: true });
      writeFileSync(join(dir, 'src', 'areas', 'jira', 'a.ts'), 'a\n');
      writeFileSync(join(dir, 'README.md'), 'r\n');
      git('add', '.');
      git('commit', '-qm', 'base');
      writeFileSync(join(dir, 'src', 'areas', 'jira', 'a.ts'), 'b\n');
      writeFileSync(join(dir, 'src', 'areas', 'jira', 'name with space.ts'), 'c\n');
      git('add', '.');
      git('commit', '-qm', 'fix');
      const entries = parseRaw(git('diff', '--raw', '-z', '--no-renames', 'HEAD~1', 'HEAD'));
      expect(entries.map((e) => e.path).sort()).toEqual(['src/areas/jira/a.ts', 'src/areas/jira/name with space.ts']);
      expect(check(entries, known)).toEqual({ ok: true, area: 'jira', refused: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the triage labels', () => {
  it('has one area: label per registered area, plus the workflow\'s own', () => {
    const names = labels().map((l) => l.name);
    expect(areas()).toContain('jira');
    expect(areas()).not.toContain('kit');
    expect(names).toEqual(expect.arrayContaining(['area:jira', 'area:github', 'from-website', 'from-terminal', 'unverified-build', 'triaged', 'denied', 'triage-queued', 'triage-claimed', 'from-triage', 'smoke-test']));
    for (const label of labels()) expect(label.name.length).toBeLessThanOrEqual(50);
  });
});
