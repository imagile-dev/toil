/**
 * Turns a git remote URL into the project, repo or owner an area needs, for
 * Bitbucket Data Center, Azure DevOps Server and GitHub. Each parser accepts
 * a remote only when its host matches the connection's base URL, so a remote
 * on some other server never supplies context to the wrong one.
 *
 * Matches the predecessor exactly, quirks included (CLAUDE.md, Matching the
 * predecessor):
 * the Bitbucket host check is a substring test against the base URL, so
 * `git@jira.imagile.dev:...` counts for a base URL of `jira.imagile.dev.corp`.
 * Any fix waits for a live run, as the procedure manual requires of all
 * improvements.
 */

/**
 * Bitbucket Data Center: `git@<host>[:port]:PROJ/repo.git`,
 * `git@<host>:7999/PROJ/repo.git`, or `https://<host>/scm/PROJ/repo.git`.
 */
export function parseBitbucketRemote(remoteUrl: string, bitbucketBaseUrl: string | undefined): { project: string; repo: string } | null {
  if (!bitbucketBaseUrl) return null;

  const base = bitbucketBaseUrl.replace(/\/$/, '').replace(/^https?:\/\//, '');

  const sshMatch = remoteUrl.match(/^git@([^:]+)(?::\d+)?[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, project, repo] = sshMatch;
    if (host && base.includes(host)) return { project: project!, repo: repo! };
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/scm\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, host, project, repo] = httpsMatch;
    if (host && base.includes(host)) return { project: project!, repo: repo! };
  }

  return null;
}

/**
 * Azure DevOps Server:
 *   `https://<host>[/<prefix>]/<collection>/<project>/_git/<repo>`
 *   `ssh://git@<host>[:<port>][/<prefix>]/<collection>/<project>/_ssh/<repo>`
 *   `git@<host>[:<port>]:<prefix>/<collection>/<project>/_ssh/<repo>`
 *
 * The segment before `_git` or `_ssh` is the project, the one before that the
 * collection; anything earlier (`/tfs/`) is a prefix and ignored. Hosts are
 * compared by hostname alone, so a port on either side doesn't matter.
 */
export function parseAdoRemote(remoteUrl: string, adoBaseUrl: string | undefined): { collection: string; project: string; repo: string } | null {
  if (!adoBaseUrl) return null;

  let baseHostname: string;
  try {
    const normalizedBase = /^https?:\/\//.test(adoBaseUrl) ? adoBaseUrl : `https://${adoBaseUrl}`;
    baseHostname = new URL(normalizedBase).hostname.toLowerCase();
  } catch {
    baseHostname = adoBaseUrl.replace(/\/$/, '').replace(/^https?:\/\//, '').split(/[:/]/)[0]!.toLowerCase();
  }

  let path = remoteUrl;
  let remoteHostname = '';

  const sshProtoMatch = path.match(/^ssh:\/\/[^@]*@?([^/:]+)(?::\d+)?(.*)/);
  if (sshProtoMatch) {
    remoteHostname = sshProtoMatch[1]!.toLowerCase();
    path = sshProtoMatch[2]!;
  } else {
    const gitAtMatch = path.match(/^git@([^:]+)(?::\d+)?:(.*)/);
    if (gitAtMatch) {
      remoteHostname = gitAtMatch[1]!.toLowerCase();
      path = '/' + gitAtMatch[2]!;
    } else {
      const httpsMatch = path.match(/^https?:\/\/([^/:]+)(?::\d+)?(.*)/);
      if (httpsMatch) {
        remoteHostname = httpsMatch[1]!.toLowerCase();
        path = httpsMatch[2]!;
      }
    }
  }

  if (!remoteHostname || remoteHostname !== baseHostname) return null;

  path = path.replace(/\.git$/, '');

  const gitIdx = path.indexOf('/_git/');
  const sshIdx = path.indexOf('/_ssh/');
  const markerIdx = gitIdx !== -1 ? gitIdx : sshIdx;
  if (markerIdx === -1) return null;

  const repo = decodeURIComponent(path.slice(markerIdx + 6));
  if (!repo) return null;

  const before = path.slice(1, markerIdx);
  const parts = before.split('/').filter(Boolean);
  if (parts.length < 2) return null;

  const project = decodeURIComponent(parts[parts.length - 1]!);
  const collection = decodeURIComponent(parts[parts.length - 2]!);

  return { collection, project, repo };
}

/**
 * GitHub and GitHub Enterprise: `git@<host>:owner/repo[.git]`,
 * `ssh://git@<host>[:port]/owner/repo[.git]`, `https://<host>/owner/repo[.git]`.
 * With no base URL only github.com matches; `api.github.com` as a base URL
 * means github.com, since that's where its remotes live.
 */
export function parseGitHubRemote(remoteUrl: string, baseUrl: string | undefined): { owner: string; repo: string } | null {
  let targetHost: string;
  if (baseUrl) {
    try {
      const normalizedBase = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
      const hostname = new URL(normalizedBase).hostname.toLowerCase();
      targetHost = hostname === 'api.github.com' ? 'github.com' : hostname;
    } catch {
      targetHost = baseUrl.replace(/\/$/, '').replace(/^https?:\/\//i, '').split(/[:/]/)[0]!.toLowerCase();
    }
  } else {
    targetHost = 'github.com';
  }

  const sshMatch = remoteUrl.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, host, owner, repo] = sshMatch;
    if (host!.toLowerCase() === targetHost) return { owner: owner!, repo: repo! };
  }

  const sshProtoMatch = remoteUrl.match(/^ssh:\/\/git@([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshProtoMatch) {
    const [, host, owner, repo] = sshProtoMatch;
    if (host!.toLowerCase() === targetHost) return { owner: owner!, repo: repo! };
  }

  const httpsMatch = remoteUrl.match(/^https?:\/\/([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, host, owner, repo] = httpsMatch;
    if (host!.toLowerCase() === targetHost) return { owner: owner!, repo: repo! };
  }

  return null;
}

/**
 * The first remote, in `git remote -v` order, that `parse` accepts for this
 * base URL. That's how each area's context was chosen: first match wins.
 */
export function firstRemoteMatch<T>(remotes: readonly string[], parse: (url: string, baseUrl: string | undefined) => T | null, baseUrl: string | undefined): T | null {
  for (const url of remotes) {
    const parsed = parse(url, baseUrl);
    if (parsed) return parsed;
  }
  return null;
}
