// GitHub, as the Imagile Bot App: a JWT signed with the App's private key buys
// an installation token for this one repository, scoped per use. Issues get an
// `issues: write` token and nothing more; the commit lookup a `contents: read`
// one. Plain fetch and node:crypto, so there is no SDK to keep current.
//
// Tokens are cached in memory until five minutes before they expire. A fresh
// token per request would be more thorough, in the way a fresh signature on
// every page of a form is more thorough.

import { createSign } from 'node:crypto';

export type Fetch = typeof fetch;
type Permissions = Record<string, 'read' | 'write'>;

export interface Issue {
  number: number;
  html_url: string;
  state: string;
  body: string | null;
  labels?: Array<{ name: string }>;
  pull_request?: unknown;
}

export interface Comment {
  body: string;
  author_association: string;
  user: { login: string; type?: string } | null;
}

/** Whether a commit hash is a commit in the repository, and whether it's on the main branch. */
export type CommitState = 'on-main' | 'elsewhere' | 'missing';

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const base64url = (input: string | Buffer): string => Buffer.from(input).toString('base64url');

export function appJwt(appId: string, privateKey: string, now: Date): string {
  const seconds = Math.floor(now.getTime() / 1000);
  // Backdated a minute for clock drift; GitHub refuses anything over ten minutes long.
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: seconds - 60, exp: seconds + 540, iss: appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  // Key Vault holds the PEM as entered; one pasted with literal \n still works.
  const pem = privateKey.includes('\\n') ? privateKey.replace(/\\n/g, '\n') : privateKey;
  return `${header}.${payload}.${signer.sign(pem).toString('base64url')}`;
}

export interface GitHubOptions {
  appId: string;
  privateKey: string;
  repo: string;
  mainBranch: string;
  api: string;
  fetch?: Fetch;
  now?: () => Date;
}

export class GitHub {
  private readonly tokens = new Map<string, { token: string; expires: number }>();
  private installationId: number | undefined;
  private readonly fetch: Fetch;
  private readonly now: () => Date;

  constructor(private readonly options: GitHubOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  get repo(): string {
    return this.options.repo;
  }

  private async call<T>(method: string, path: string, auth: string, body?: unknown, okMissing = false): Promise<T | undefined> {
    const response = await this.fetch(`${this.options.api}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: auth,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'toil-feedback',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (okMissing && (response.status === 404 || response.status === 422)) return undefined;
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new GitHubError(`GitHub ${method} ${path} returned ${response.status}: ${detail}`, response.status);
    }
    if (response.status === 204) return undefined;
    return (await response.json()) as T;
  }

  /** An installation token for this repository with exactly these permissions. */
  async token(permissions: Permissions): Promise<string> {
    const key = JSON.stringify(Object.entries(permissions).sort());
    const cached = this.tokens.get(key);
    const now = this.now().getTime();
    if (cached && cached.expires - 5 * 60_000 > now) return cached.token;
    const jwt = `Bearer ${appJwt(this.options.appId, this.options.privateKey, this.now())}`;
    if (this.installationId === undefined) {
      const installation = await this.call<{ id: number }>('GET', `/repos/${this.options.repo}/installation`, jwt);
      this.installationId = installation!.id;
    }
    const name = this.options.repo.split('/')[1];
    const minted = await this.call<{ token: string; expires_at: string }>(
      'POST',
      `/app/installations/${this.installationId}/access_tokens`,
      jwt,
      { repositories: [name], permissions },
    );
    this.tokens.set(key, { token: minted!.token, expires: Date.parse(minted!.expires_at) });
    return minted!.token;
  }

  private async issues(): Promise<string> {
    return `token ${await this.token({ issues: 'write' })}`;
  }

  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<Issue> {
    return (await this.call<Issue>('POST', `/repos/${this.options.repo}/issues`, await this.issues(), input))!;
  }

  async getIssue(number: number): Promise<Issue> {
    return (await this.call<Issue>('GET', `/repos/${this.options.repo}/issues/${number}`, await this.issues()))!;
  }

  async updateIssue(number: number, patch: Record<string, unknown>): Promise<Issue> {
    return (await this.call<Issue>('PATCH', `/repos/${this.options.repo}/issues/${number}`, await this.issues(), patch))!;
  }

  /** Issues (not PRs) with a label, oldest first, open and closed. */
  async issuesLabelled(label: string): Promise<Issue[]> {
    const query = `labels=${encodeURIComponent(label)}&state=all&sort=created&direction=asc&per_page=20`;
    const found = (await this.call<Issue[]>('GET', `/repos/${this.options.repo}/issues?${query}`, await this.issues())) ?? [];
    return found.filter((issue) => !issue.pull_request);
  }

  /** The newest comments on an issue, oldest first (GitHub lists them in that order). */
  async recentComments(number: number, total: number): Promise<Comment[]> {
    const perPage = 30;
    const page = Math.max(1, Math.ceil(total / perPage));
    const path = `/repos/${this.options.repo}/issues/${number}/comments?per_page=${perPage}&page=${page}`;
    return (await this.call<Comment[]>('GET', path, await this.issues())) ?? [];
  }

  /**
   * Whether `sha` is a commit here, and whether the main branch contains it. One
   * compare call answers both: main is ahead of (or identical to) a commit it
   * contains, and GitHub answers 404 for a hash it doesn't have.
   */
  async commitState(sha: string): Promise<CommitState> {
    const auth = `token ${await this.token({ contents: 'read' })}`;
    const path = `/repos/${this.options.repo}/compare/${sha}...${encodeURIComponent(this.options.mainBranch)}?per_page=1`;
    const compared = await this.call<{ status: string }>('GET', path, auth, undefined, true);
    if (!compared) return 'missing';
    return compared.status === 'ahead' || compared.status === 'identical' ? 'on-main' : 'elsewhere';
  }
}
