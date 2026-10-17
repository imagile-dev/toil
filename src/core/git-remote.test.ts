import { describe, it, expect } from 'vitest';

// The predecessor's remote-parsing cases, carried over unchanged, plus the
// quirks they imply. Precedent is binding until a live run sets a new one.
import { firstRemoteMatch, parseAdoRemote, parseBitbucketRemote, parseGitHubRemote } from './git-remote.js';

describe('parseBitbucketRemote', () => {
  it('returns null when bitbucketBaseUrl is undefined', () => {
    expect(parseBitbucketRemote('git@bitbucket.imagile.dev:7999/PROJ/repo.git', undefined)).toBeNull();
  });

  it('parses SSH format', () => {
    const result = parseBitbucketRemote(
      'git@bitbucket.imagile.dev:7999/PROJ/repo.git',
      'https://bitbucket.imagile.dev'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('parses SSH format without .git suffix', () => {
    const result = parseBitbucketRemote(
      'git@bitbucket.imagile.dev:7999/PROJ/repo',
      'https://bitbucket.imagile.dev'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('parses HTTPS format', () => {
    const result = parseBitbucketRemote(
      'https://bitbucket.imagile.dev/scm/PROJ/repo.git',
      'https://bitbucket.imagile.dev'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('parses HTTPS format without .git suffix', () => {
    const result = parseBitbucketRemote(
      'https://bitbucket.imagile.dev/scm/PROJ/repo',
      'https://bitbucket.imagile.dev'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('returns null when host does not match base URL', () => {
    const result = parseBitbucketRemote(
      'git@other.example.com:7999/PROJ/repo.git',
      'https://bitbucket.imagile.dev'
    );
    expect(result).toBeNull();
  });

  it('handles base URL with trailing slash', () => {
    const result = parseBitbucketRemote(
      'https://bitbucket.imagile.dev/scm/PROJ/repo.git',
      'https://bitbucket.imagile.dev/'
    );
    expect(result).toEqual({ project: 'PROJ', repo: 'repo' });
  });
});

describe('parseAdoRemote', () => {
  it('returns null when adoBaseUrl is undefined', () => {
    expect(parseAdoRemote('https://tfs.imagile.dev/col/proj/_git/repo', undefined)).toBeNull();
  });

  it('parses HTTPS format', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/col/proj/_git/repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses HTTPS format with .git suffix', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/col/proj/_git/repo.git',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses HTTPS format with path prefix', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/tfs/col/proj/_git/repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses SSH protocol format', () => {
    const result = parseAdoRemote(
      'ssh://git@tfs.imagile.dev:22/col/proj/_ssh/repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('parses base URL with port', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev:8080/col/proj/_git/repo',
      'https://tfs.imagile.dev:8080'
    );
    expect(result).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });

  it('returns null when host does not match', () => {
    const result = parseAdoRemote(
      'https://other.example.com/col/proj/_git/repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toBeNull();
  });

  it('returns null when no _git or _ssh segment', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/col/proj/repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toBeNull();
  });

  it('returns null when not enough path segments before marker', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/proj/_git/repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toBeNull();
  });

  it('decodes percent-encoded project name from HTTPS URL', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/col/My%20Project/_git/myrepo',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'col', project: 'My Project', repo: 'myrepo' });
  });

  it('decodes percent-encoded collection and repo names', () => {
    const result = parseAdoRemote(
      'https://tfs.imagile.dev/My%20Org/My%20Project/_git/My%20Repo',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'My Org', project: 'My Project', repo: 'My Repo' });
  });

  it('decodes percent-encoded project name from SSH URL', () => {
    const result = parseAdoRemote(
      'ssh://git@tfs.imagile.dev:22/col/My%20Project/_ssh/myrepo',
      'https://tfs.imagile.dev'
    );
    expect(result).toEqual({ collection: 'col', project: 'My Project', repo: 'myrepo' });
  });
});

describe('parseGitHubRemote', () => {
  it('parses git@ SSH format on github.com', () => {
    expect(parseGitHubRemote('git@github.com:imagile/widgets.git', undefined))
      .toEqual({ owner: 'imagile', repo: 'widgets' });
  });

  it('parses HTTPS format on github.com', () => {
    expect(parseGitHubRemote('https://github.com/imagile/widgets.git', undefined))
      .toEqual({ owner: 'imagile', repo: 'widgets' });
  });

  it('parses ssh:// protocol format on github.com', () => {
    expect(parseGitHubRemote('ssh://git@github.com/imagile/widgets.git', undefined))
      .toEqual({ owner: 'imagile', repo: 'widgets' });
  });

  it('parses ssh:// protocol format with a port', () => {
    expect(parseGitHubRemote('ssh://git@github.com:22/imagile/widgets.git', undefined))
      .toEqual({ owner: 'imagile', repo: 'widgets' });
  });

  it('matches a GitHub Enterprise host when baseUrl is provided', () => {
    expect(parseGitHubRemote('ssh://git@ghe.imagile.dev/org/repo.git', 'https://ghe.imagile.dev'))
      .toEqual({ owner: 'org', repo: 'repo' });
    expect(parseGitHubRemote('git@ghe.imagile.dev:org/repo.git', 'https://ghe.imagile.dev'))
      .toEqual({ owner: 'org', repo: 'repo' });
  });

  it('matches github.com remotes when baseUrl is api.github.com', () => {
    expect(parseGitHubRemote('git@github.com:imagile/widgets.git', 'https://api.github.com'))
      .toEqual({ owner: 'imagile', repo: 'widgets' });
    expect(parseGitHubRemote('https://github.com/imagile/widgets.git', 'https://api.github.com'))
      .toEqual({ owner: 'imagile', repo: 'widgets' });
  });

  it('returns null when the host does not match the target', () => {
    expect(parseGitHubRemote('git@gitlab.com:org/repo.git', undefined)).toBeNull();
    expect(parseGitHubRemote('ssh://git@gitlab.com/org/repo.git', undefined)).toBeNull();
  });
});

describe('quirks kept from the predecessor (suspected bugs, pinned until a live run)', () => {
  it('Bitbucket matches a host that is merely a substring of the base URL', () => {
    expect(parseBitbucketRemote('git@imagile.dev:PROJ/repo.git', 'https://bitbucket.imagile.dev')).toEqual({ project: 'PROJ', repo: 'repo' });
  });

  it('ADO falls back to _ssh only when there is no _git segment', () => {
    expect(parseAdoRemote('ssh://git@tfs.imagile.dev:22/tfs/col/proj/_ssh/repo', 'https://tfs.imagile.dev:8080')).toEqual({ collection: 'col', project: 'proj', repo: 'repo' });
  });
});

describe('firstRemoteMatch', () => {
  it('takes the first remote, in git remote -v order, that parses for the base URL', () => {
    const remotes = ['git@github.com:imagile/one.git', 'https://bitbucket.imagile.dev/scm/PROJ/two.git', 'https://bitbucket.imagile.dev/scm/PROJ/three.git'];
    expect(firstRemoteMatch(remotes, parseBitbucketRemote, 'https://bitbucket.imagile.dev')).toEqual({ project: 'PROJ', repo: 'two' });
    expect(firstRemoteMatch(remotes, parseGitHubRemote, undefined)).toEqual({ owner: 'imagile', repo: 'one' });
    expect(firstRemoteMatch(remotes, parseAdoRemote, 'https://tfs.imagile.dev')).toBeNull();
  });
});
