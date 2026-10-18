import { describe, expect, it } from 'vitest';
import { hasSecretUserinfo, normalizeRemote, samePath, stripUserinfo, validateDossier } from './dossier.js';

const areas = [
  { name: 'jira', context: ['project'] },
  { name: 'openshift', context: ['env', 'instance'] },
];

describe('remotes', () => {
  it('normalise so the SSH and HTTPS remotes of one repository compare equal', () => {
    const same = [
      'https://git.imagile.dev/pay/payments-api.git',
      'https://git.imagile.dev/pay/payments-api',
      'https://user:t0ken@GIT.imagile.dev:8443/pay/payments-api.git/',
      'ssh://git@git.imagile.dev:22/pay/payments-api.git',
      'git@git.imagile.dev:pay/payments-api.git',
      'git.imagile.dev:pay/payments-api',
    ];
    expect(new Set(same.map(normalizeRemote))).toEqual(new Set(['git.imagile.dev/pay/payments-api']));
    expect(normalizeRemote('https://git.imagile.dev/pay/other.git')).not.toBe(normalizeRemote(same[0]!));
  });

  it('keep a Windows path a path, not an scp-style host', () => {
    expect(normalizeRemote('C:\\Code\\repo.git')).toBe('C:/Code/repo');
    expect(normalizeRemote('C:/Code/repo/')).toBe('C:/Code/repo');
  });

  it('call http(s) userinfo and any password a credential, and a bare ssh login name not', () => {
    expect(hasSecretUserinfo('https://t0ken@git.imagile.dev/x.git')).toBe(true);
    expect(hasSecretUserinfo('ssh://git:pw@git.imagile.dev/x.git')).toBe(true);
    expect(hasSecretUserinfo('ssh://git@git.imagile.dev/x.git')).toBe(false);
    expect(hasSecretUserinfo('git@git.imagile.dev:x.git')).toBe(false);
    expect(stripUserinfo('https://bob:hunter2@git.imagile.dev/x.git')).toBe('https://git.imagile.dev/x.git');
    expect(stripUserinfo('git@git.imagile.dev:x.git')).toBe('git@git.imagile.dev:x.git');
  });
});

describe('samePath', () => {
  it('ignores case and slash direction on Windows only', () => {
    expect(samePath('C:\\Code\\Repo', 'c:/code/repo/', 'win32')).toBe(true);
    expect(samePath('/code/Repo', '/code/repo', 'linux')).toBe(false);
  });
});

describe('validateDossier', () => {
  it('loads a valid dossier, keeping reference data and unknown sections, and strips credentials from remotes', () => {
    const { dossier, problems } = validateDossier(
      {
        name: 'payments',
        env: 'prod',
        repos: [{ name: 'api', path: 'C:/Code/api', remotes: ['https://bob:pw@git.imagile.dev/pay/api.git'] }],
        jira: { host: 'jira.imagile.dev', project: 'PAY', projects: ['PAY', 'PAY'], fields: { storyPoints: 'customfield_1', points: 'customfield_1' } },
        nonesuch: { anything: true },
        environments: { prod: { openshift: { connection: 'ocp-prod', namespace: 'payments-prod' } } },
      },
      areas,
    );
    expect(dossier?.repos[0]?.remotes).toEqual(['https://git.imagile.dev/pay/api.git']);
    expect(dossier?.sections.nonesuch).toEqual({ anything: true });
    expect(dossier?.environments.prod?.openshift).toMatchObject({ namespace: 'payments-prod' });
    expect(problems.map((p) => [p.level, p.code, p.path])).toEqual([
      ['warning', 'DOSSIER_REMOTE_USERINFO', 'repos[0].remotes[0]'],
      ['warning', 'DOSSIER_DUPLICATE', 'jira.fields.points'],
      ['warning', 'DOSSIER_DUPLICATE', 'jira.projects[1]'],
      ['warning', 'DOSSIER_UNKNOWN_SECTION', 'nonesuch'],
    ]);
  });

  it("refuses what it can't use, by key path", () => {
    const { dossier, problems } = validateDossier(
      {
        name: 'Payments',
        env: 'nowhere',
        repos: [{ name: 'a' }, { path: 'x' }],
        jira: { connection: 'corp-jira', host: 'jira.imagile.dev', project: 7, fields: { 'story points': 'x' } },
        openshift: { host: 'https://api.ocp.imagile.dev' },
      },
      areas,
    );
    expect(dossier).toBeUndefined();
    expect(problems.filter((p) => p.level === 'error').map((p) => p.path)).toEqual(['name', 'repos[1]', 'jira', 'jira.fields.story points', 'jira.project', 'openshift.host', 'env']);
  });

  it('reports the same repo name, path or remote twice', () => {
    const { problems } = validateDossier(
      {
        name: 'p',
        repos: [
          { name: 'a', path: 'C:/x', remotes: ['git@git.imagile.dev:p/a.git'] },
          { name: 'a', path: 'C:/x', remotes: ['https://git.imagile.dev/p/a'] },
        ],
      },
      areas,
    );
    expect(problems.map((p) => p.path)).toEqual(['repos[1].name', 'repos[1].path', 'repos[1].remotes[0]']);
  });
});
