# toil feedback backend

An Azure Function (Node.js 24, v4 programming model) behind the site's
[feedback page](https://imagile-dev.github.io/toil/feedback/) and its curl endpoint.
Reports become GitHub issues filed by the Imagile Bot, and the submitter gets an
email when the issue is filed and when it closes. It is its own private package,
like `site/`, and is never published.

| Function | Trigger | What it does |
|---|---|---|
| `Submit` | `POST /api/submit` | The site's form. Honeypot, then `Origin`, validation, Turnstile, and the per-IP daily limit (10), in that order. Stores a pending row. |
| `Report` | `POST /api/report` | curl, for networks where Turnstile can't load. No CAPTCHA and no `Origin` check; instead `commit` must be a commit in the repository (checked through the GitHub API, cached in a table). Per-IP limit 3 a day, checked before the lookup. |
| `ProcessSubmissions` | timer, every minute | Files pending rows as issues, oldest first, at most `DAILY_SUBMISSION_LIMIT` (10) a UTC day. Labels: `bug` or `enhancement`; `from-website` or `from-terminal`; `unverified-build` when a reported commit isn't on `main`. Records issue → email, sends the confirmation, and retries failures on the next tick without filing twice. |
| `IssueWebhook` | `POST /api/webhook/issue` | Verifies GitHub's HMAC signature. When a submitted issue closes, emails the submitter the close reason and the last maintainer comment, then forgets the address. |

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
| `GITHUB_REPO`, `GITHUB_APP_ID`, `ALLOWED_ORIGIN`, `DAILY_SUBMISSION_LIMIT`, `IP_DAILY_LIMIT`, `REPORT_IP_DAILY_LIMIT`, `STALE_SUBMISSION_MINUTES`, `EMAIL_FROM_ADDRESS`, `FEEDBACK_TABLES_ENDPOINT` | Bicep |
| `GITHUB_APP_PRIVATE_KEY` | Key Vault `GITHUB-APP-PRIVATE-KEY` (the Imagile Bot App) |
| `TURNSTILE_SECRET` | Key Vault `TURNSTILE-SECRET` |
| `SMOKE_TEST_KEY` | Key Vault `SMOKE-TEST-KEY` |
| `ACS_CONNECTION_STRING` | Key Vault `ACS-CONNECTION-STRING` (`imagile-comms`, sending as `no-reply@imagile.dev`) |
| `WEBHOOK_SECRET` | Key Vault `TOIL-WEBHOOK-SECRET` (made by hand, below) |

## Cost

Everything is in its own resource group, `rg-toil-feedback`, in the Imagile Paid
subscription (capped at $50 a month). Nothing is always on. Retail prices in
eastus2 on 2026-10-18:

| Item | Monthly |
|---|---|
| Flex Consumption, 512 MB, no always-ready instances, at most 2 on-demand instances. The timer's 43,200 runs are inside the free 250,000 executions; at the 1-second minimum billing that's about 21,600 GB-s, inside the free 100,000 GB-s | ~$0 |
| Storage account (tables, the deployment package, timer leases) | ~$0.10–0.50 |
| Log Analytics and Application Insights, capped at 0.2 GB a day, inside the free 5 GB a month | ~$0 |
| ACS email, $0.00025 each | ~$0.01 |
| Three log alerts every 15 minutes, $0.50 each | $1.50 |
| **Total** | **~$1.60–2.00** |

The deploy workflow refuses to run when Azure's forecast for the month is over $50.

## One-time manual steps

These are deliberately not automated: each one grants access or creates a
credential, and a maintainer does it once.

1. **Resource group and deploy identity.** Create `rg-toil-feedback` (eastus2). Create
   an Entra app registration (or user-assigned identity) for the deploy, with a
   federated credential for `repo:imagile-dev/toil:environment:feedback`, and set the
   repository variables `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and
   `AZURE_SUBSCRIPTION_ID`. Create the `feedback` environment in the repository
   settings. Give the identity:
   - `Contributor` on `rg-toil-feedback`
   - `Role Based Access Control Administrator` on `rg-toil-feedback`, so the template
     can grant the function's identity its two storage roles (it can be limited to
     `Storage Blob Data Owner` and `Storage Table Data Contributor`)
   - `Cost Management Reader` on the subscription, for the deploy's cost gate
   - `Key Vault Secrets User` on the `SMOKE-TEST-KEY` secret in `imagile-keyvault`,
     for the smoke test
2. **Key Vault access for the function.** After the first deploy creates
   `func-toil-feedback`, grant its system-assigned identity `Key Vault Secrets User`
   on `imagile-keyvault`. Until then its Key Vault references don't resolve.
3. **The webhook secret.** Create the `TOIL-WEBHOOK-SECRET` secret in
   `imagile-keyvault` with a long random value, and add a repository webhook to
   `https://func-toil-feedback.azurewebsites.net/api/webhook/issue` with the same
   secret, content type `application/json`, and only the **Issues** event.
4. **The Imagile Bot App.** It's already installed on the repository. It needs
   `Issues: write` (filing) and `Contents: read` (the commit lookup); the triage
   workflow also uses `Contents: write` and `Pull requests: write`. It must not have
   `Workflows`.
5. **Turnstile.** Add `imagile-dev.github.io` to the hostnames of the existing
   Turnstile widget in Cloudflare (the site key in `site/src/data/feedback.ts`).
6. **The ACS domain.** `imagile.dev` is already verified on `imagile-email` and linked
   to `imagile-comms`, with the `no-reply` sender. Nothing to do unless that changes.
7. **Triage.** Set the `REDACT_TERMS` repository secret (one entry per line; see
   `scripts/triage/redact.mjs`). The workflow runs without it, with only the built-in
   rules.

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
