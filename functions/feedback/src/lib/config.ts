// Settings come from the function app's app settings: plain values in Bicep,
// secrets as Key Vault references the platform resolves before Node starts.
// Read once per invocation from an env record, so tests hand in their own.
//
// Every setting has a default or a loud failure; a form that quietly accepts
// submissions into a misconfigured void is a filing cabinet with no back.

export interface Settings {
  /** owner/name of the repository issues are filed in. */
  repo: string;
  /** The branch a reported commit must be on to count as a released build. */
  mainBranch: string;
  /** The site's origin, the only one /api/submit accepts. */
  allowedOrigin: string;
  /** Issues created per UTC day, smoke runs excluded. */
  dailyIssueLimit: number;
  /** Submissions per IP per UTC day through /api/submit. */
  submitIpDailyLimit: number;
  /** Submissions per IP per UTC day through /api/report. */
  reportIpDailyLimit: number;
  /** /api/report submissions per UTC day across every caller. */
  reportDailyLimit: number;
  /** GitHub commit lookups per UTC day across every caller (cache hits don't count). */
  commitLookupDailyLimit: number;
  /** Pending rows past which nothing more is queued. */
  maxPending: number;
  /** Minutes an attempted submission may stay unconverted before it counts as stuck. */
  staleMinutes: number;
  emailFrom: string;
  githubAppId: string | undefined;
  githubPrivateKey: string | undefined;
  turnstileSecret: string | undefined;
  smokeTestKey: string | undefined;
  webhookSecret: string | undefined;
  acsConnectionString: string | undefined;
  /** GitHub's API root; only a local end-to-end run points it elsewhere. */
  githubApi: string;
}

const intSetting = (env: Record<string, string | undefined>, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of 0 or more, not "${raw}".`);
  return value;
};

const text = (env: Record<string, string | undefined>, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

export function readSettings(env: Record<string, string | undefined> = process.env): Settings {
  const repo = text(env, 'GITHUB_REPO') ?? 'imagile-dev/toil';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error(`GITHUB_REPO must be owner/name, not "${repo}".`);
  return {
    repo,
    mainBranch: text(env, 'GITHUB_MAIN_BRANCH') ?? 'main',
    allowedOrigin: text(env, 'ALLOWED_ORIGIN') ?? 'https://imagile-dev.github.io',
    dailyIssueLimit: intSetting(env, 'DAILY_SUBMISSION_LIMIT', 10),
    submitIpDailyLimit: intSetting(env, 'IP_DAILY_LIMIT', 10),
    reportIpDailyLimit: intSetting(env, 'REPORT_IP_DAILY_LIMIT', 3),
    reportDailyLimit: intSetting(env, 'REPORT_DAILY_LIMIT', 30),
    commitLookupDailyLimit: intSetting(env, 'COMMIT_LOOKUP_DAILY_LIMIT', 50),
    maxPending: intSetting(env, 'MAX_PENDING_SUBMISSIONS', 100),
    staleMinutes: intSetting(env, 'STALE_SUBMISSION_MINUTES', 15),
    emailFrom: text(env, 'EMAIL_FROM_ADDRESS') ?? 'no-reply@imagile.dev',
    githubAppId: text(env, 'GITHUB_APP_ID'),
    githubPrivateKey: text(env, 'GITHUB_APP_PRIVATE_KEY'),
    turnstileSecret: text(env, 'TURNSTILE_SECRET'),
    smokeTestKey: text(env, 'SMOKE_TEST_KEY'),
    webhookSecret: text(env, 'WEBHOOK_SECRET'),
    acsConnectionString: text(env, 'ACS_CONNECTION_STRING'),
    githubApi: (text(env, 'GITHUB_API_URL') ?? 'https://api.github.com').replace(/\/+$/, ''),
  };
}
