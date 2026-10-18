# toil feedback backend

An Azure Function (Node.js 24, v4 programming model) behind the site's
[feedback page](https://imagile-dev.github.io/toil/feedback/) and its curl endpoint.
Reports become GitHub issues filed by the Imagile Bot, and the submitter gets an
email when the issue is filed and when it closes. It is its own private package,
like `site/`, and is never published.

| Function | Trigger | What it does |
|---|---|---|
| `Submit` | `POST /api/submit` | The site's form. Honeypot, then `Origin`, validation, Turnstile, and the per-IP daily limit (10), in that order. Stores a pending row. |
| `Report` | `POST /api/report` | curl, for networks where Turnstile can't load. No CAPTCHA and no `Origin` check; instead `commit` must be a commit in the repository (checked through the GitHub API, cached in a table). Per-IP limit 3 a day, then a total of `REPORT_DAILY_LIMIT` (30) a day across every caller, both checked before the lookup; lookups themselves are capped at `COMMIT_LOOKUP_DAILY_LIMIT` (50) a day. |
| `ProcessSubmissions` | timer, every minute | Files pending rows as issues, oldest first, at most `DAILY_SUBMISSION_LIMIT` (10) a UTC day. Labels: `bug` or `enhancement`; `from-website` or `from-terminal`; `unverified-build` when a reported commit isn't on `main`. Records issue → email, sends the confirmation, and retries failures on the next tick without filing twice. |
| `IssueWebhook` | `POST /api/webhook/issue` | Verifies GitHub's HMAC signature. When a submitted issue closes, emails the submitter the close reason and the last maintainer comment, then forgets the address. |

**Limits that hold whatever a caller claims.** The client address is the last
`X-Forwarded-For` entry, the one Azure's front end appends to whatever the caller
sent, so a forged header earns no fresh allowance (Microsoft Learn, "Protocol
support for HTTP headers in Azure Front Door": "If there's an existing XFF header,
then Front Door appends the client socket IP to it"). Confirm it on the first
deploy: two reports with different forged `X-Forwarded-For` values from one machine
must share one allowance. On top of the per-IP limits, nothing more is queued once
`MAX_PENDING_SUBMISSIONS` (100) rows are waiting, `/api/report` takes at most
`REPORT_DAILY_LIMIT` (30) a day in all, and GitHub commit lookups stop at
`COMMIT_LOOKUP_DAILY_LIMIT` (50) a day. Each answers a plain 429.

Submissions carrying the `X-Smoke-Test-Key` header (the key is in Key Vault) skip
Turnstile and nothing else, and are recorded on one persistent, closed `smoke-test`
issue instead of a new one. The deploy's smoke test (`scripts/smoke.mjs`) uses it.

## Storage

Azure Table Storage, reached with the function's managed identity (the account
has shared-key access off):

| Table | Holds |
|---|---|
| `submissions` | Pending submissions, deleted once filed and emailed |
| `ratelimits` | Per-IP daily counts; the IP is stored only as a SHA-256 prefix |
| `counters` | Issues created per UTC day |
| `issues` | Issue number → email and title, deleted once the closed notice is sent |
| `commits` | What GitHub said about each reported commit |

## Settings

Plain values come from `infra/main.bicep`; secrets are Key Vault references to the
existing `imagile-keyvault`, never copied anywhere else.

| Setting | Source |
|---|---|
| `GITHUB_REPO`, `GITHUB_APP_ID`, `ALLOWED_ORIGIN`, `DAILY_SUBMISSION_LIMIT`, `IP_DAILY_LIMIT`, `REPORT_IP_DAILY_LIMIT`, `REPORT_DAILY_LIMIT`, `COMMIT_LOOKUP_DAILY_LIMIT`, `MAX_PENDING_SUBMISSIONS`, `STALE_SUBMISSION_MINUTES`, `EMAIL_FROM_ADDRESS`, `FEEDBACK_TABLES_ENDPOINT` | Bicep |
| `GITHUB_APP_PRIVATE_KEY` | Key Vault `GITHUB-APP-PRIVATE-KEY` (the Imagile Bot App) |
| `TURNSTILE_SECRET` | Key Vault `TURNSTILE-SECRET` |
| `SMOKE_TEST_KEY` | Key Vault `SMOKE-TEST-KEY` (made by `infra/bootstrap.sh` if missing) |
| `ACS_CONNECTION_STRING` | Key Vault `ACS-CONNECTION-STRING` (`imagile-comms`, sending as `no-reply@imagile.dev`) |
| `WEBHOOK_SECRET` | Key Vault `TOIL-WEBHOOK-SECRET` (made by `infra/bootstrap.sh`, below) |

## Cost

Everything is in its own resource group, `rg-toil-feedback`, in the Imagile Paid
subscription (budget $60 a month). Nothing is always on. Retail prices in
eastus2 on 2026-10-18:

| Item | Monthly |
|---|---|
| Flex Consumption, 512 MB, no always-ready instances, at most 2 on-demand instances. The timer's 43,200 runs are inside the free 250,000 executions; at the 1-second minimum billing that's about 21,600 GB-s, inside the free 100,000 GB-s | ~$0 |
| Storage account (tables, the deployment package, timer leases) | ~$0.10–0.50 |
| Log Analytics and Application Insights, capped at 0.2 GB a day, inside the free 5 GB a month | ~$0 |
| ACS email, $0.00025 each | ~$0.01 |
| Three log alerts every 15 minutes, $0.50 each | $1.50 |
| **Total** | **~$1.60–2.00** |

The deploy workflow refuses to run when Azure's forecast for the month is over the $60 budget.

## One-time setup

`infra/bootstrap.sh` does it, signed in to `az` (an Owner on Imagile Paid) and `gh`
(an admin of the repository). Every step checks first and does only what's missing,
so it's safe to run again; it never prints a secret, never puts one on a command line,
and never overwrites an existing Key Vault secret.

```bash
bash infra/bootstrap.sh
```

| Step | What it makes or checks |
|---|---|
| 1 | Resource group `rg-toil-feedback` (eastus2) |
| 2 | Deploy identity: the `toil-feedback-deploy` app registration and service principal, a federated credential for `repo:imagile-dev/toil:environment:feedback`, the `feedback` environment, and the `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` repository variables |
| 3 | Its roles: Contributor on the resource group; Role Based Access Control Administrator there, limited by a condition to granting or removing Storage Blob Data Owner and Storage Table Data Contributor; Cost Management Reader on the subscription (the deploy's cost gate) |
| 4 | `id-toil-feedback-kv`, a user-assigned identity with Key Vault Secrets User on `imagile-keyvault`, which `infra/main.bicep` attaches to the app for its Key Vault references, so they resolve on the first deploy |
| 5 | `SMOKE-TEST-KEY`, if missing (a random value), and Key Vault Secrets User on that one secret for the deploy identity (the smoke test reads it) |
| 6 | `TOIL-WEBHOOK-SECRET`, if missing, and the repository webhook to `/api/webhook/issue` (Issues only, JSON) signed with it, if missing |
| 7 | Read only: the Imagile Bot App has Issues, Contents and Pull requests write, and no Workflows |
| 8 | Read only: `imagile.dev` is verified and linked to Communication Services |

Two steps stay with the maintainer, and the script ends by printing them:

1. **Turnstile hostname.** Add `imagile-dev.github.io` to the hostnames of the
   existing Turnstile widget in Cloudflare (the site key in `site/src/data/feedback.ts`).
2. **`REDACT_TERMS`.** The private denylist triage redacts, one entry per line (see
   `scripts/triage/redact.mjs`):
   `gh secret set REDACT_TERMS --repo imagile-dev/toil < terms.txt`. Triage runs
   without it, with only the built-in rules.

## Develop

```bash
npm ci --ignore-scripts
npm run typecheck
npm test            # every edge is a fake: tables in memory, GitHub, Turnstile and ACS stubbed
npm run build
```

To run it locally, copy `local.settings.json.example` to `local.settings.json`,
start Azurite, point `GITHUB_API_URL` at a local stand-in for GitHub (never the real
App key), and run `npm start` (Azure Functions Core Tools).
