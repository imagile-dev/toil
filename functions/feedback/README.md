# toil feedback backend

An Azure Function (Node.js 24, v4 programming model) behind the site's
[feedback page](https://imagile-dev.github.io/toil/about/feedback/) and its curl endpoint.
Reports become GitHub issues filed by the Imagile Bot, and the submitter gets an
email when the issue is filed and when it closes. It is its own private package,
like `site/`, and is never published.

Flex Consumption takes the Node runtime by major version only (`runtime: { name:
'node', version: '24' }` in `infra/main.bicep`); Azure picks and patches the minor
and patch release on its own schedule, and neither the template nor `az functionapp
config show` names it. Its build and tests run on the patched 24.22.1
(`feedback-deploy.yml`, CVE-2026-111497, #479).

The two emails (`src/lib/templates.ts`) are in Toil UI Plain's colours: its light
scheme inline, and its dark scheme for clients that honour `prefers-color-scheme`.
The colours are a copy in `src/lib/palette.ts`, because clients need inline hex;
`test/brand-sync.test.ts` at the repository root fails when the copy differs from
`ui/themes/plain/theme.json`, or when a text colour falls under 4.5:1.

| Function | Trigger | What it does |
|---|---|---|
| `Submit` | `POST /api/submit` | The site's form. Honeypot, then `Origin`, validation, consent, Turnstile, and the per-IP daily limit (10), in that order. Stores a pending row. |
| `Report` | `POST /api/report` | curl, for networks where Turnstile can't load. Validation and consent first. No CAPTCHA and no `Origin` check; instead `commit` must be a commit in the repository (checked through the GitHub API, cached in a table). Per-IP limit 3 a day, then a total of `REPORT_DAILY_LIMIT` (30) a day across every caller, both checked before the lookup; lookups themselves are capped at `COMMIT_LOOKUP_DAILY_LIMIT` (50) a day. |
| `ProcessSubmissions` | timer, every minute | Files pending rows as issues, oldest first, each with its title and body redacted first (below), at most `DAILY_SUBMISSION_LIMIT` (10) a UTC day. Labels: `bug` or `enhancement`; `from-website` or `from-terminal`; `unverified-build` when a reported commit isn't on `main`. The issue's footer says which version of the feedback disclaimer the reporter accepted. Records issue → email, sends the confirmation, and retries failures on the next tick without filing twice. |
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

## Request format

Both endpoints take one JSON object, at most 16 KB, and refuse any field they
don't know with a 400 that lists the allowed ones.

| Field | Endpoint | |
|---|---|---|
| `kind` | both | `"bug"` or `"feature"` |
| `title` | both | 1 to 120 characters |
| `body` | both | 1 to 4000 characters |
| `email` | both | Where the issue link and the closing notice go; never shown on GitHub |
| `consent` | both | The number `1`: the version of the feedback disclaimer the reporter agrees to |
| `commit` | `/api/report` | The 40-character hash `toil version --select data.commit` prints |
| `version` | `/api/report` | Optional: what `toil version --select data.version` prints |
| `turnstileToken`, `website` | `/api/submit` | The CAPTCHA token, and the honeypot people never see |

```bash
curl -sS https://func-toil-feedback.azurewebsites.net/api/report \
  -H 'Content-Type: application/json' \
  -d '{"kind":"bug","title":"…","body":"…","email":"you@example.com","consent":1,"commit":"<hash>"}'
```

**Consent.** Every report becomes a public issue, so neither endpoint takes one
without `"consent": 1`, which says the reporter agrees to version 1 of the feedback
disclaimer in `src/lib/consent.ts` (the site and every other copy are pinned to it by
`test/feedback-consent.test.ts` at the repository root). A missing value, or anything
but the number 1 (`true`, `"1"`, `0`, `2`), is a 400 whose message quotes the
disclaimer. The check comes straight after validation, before Turnstile and every
limit, so a refused report costs no allowance. The agreed version is stored on the
queued row as `consentVersion` and named in the issue's footer; a row queued before
consent was asked for is still filed, and its footer says it predates the
disclaimer. Changing the wording means bumping `CONSENT_VERSION` and every copy.

**Redaction.** A report's title and body are redacted before its issue is created,
with the module triage uses, `scripts/triage/redact.mjs`: credential-shaped strings
(the token shapes in `src/core/token-shapes.mjs` and the key-name rules), email
addresses, internal hosts, private IPv4 addresses, and the organization denylist in
`REDACT_TERMS`. So no revision of the issue ever holds what triage would remove, and GitHub's
edit history has nothing to keep.
Triage redacts again before its agent reads the issue; the module is idempotent, so
that pass changes nothing unless the denylist has grown. With `REDACT_TERMS` empty,
the built-in rules still apply, as they do in triage; with its Key Vault reference
unresolved, the timer logs a warning and does the same. The queued row, the
confirmation email and the closed notice keep the reporter's own words: they go only
to the reporter. `npm run build` copies the two shared modules into `dist/` at their
repository paths (`scripts/copy-shared.mjs`) and checks the built function redacts.

Submissions carrying the `X-Smoke-Test-Key` header (the key is in Key Vault) skip
Turnstile and nothing else, and are recorded on one persistent, closed `smoke-test`
issue instead of a new one, with their titles redacted like any report. The deploy's smoke test (`scripts/smoke.mjs`) uses it, checks that a report without consent is refused with 400, and sends a private address in one title that must arrive as `[redacted-ip]`.

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
| `GITHUB_REPO`, `GITHUB_APP_ID` (the `IMAGILE_BOT_APP_ID` repository variable, passed by the deploy), `ALLOWED_ORIGIN`, `DAILY_SUBMISSION_LIMIT`, `IP_DAILY_LIMIT`, `REPORT_IP_DAILY_LIMIT`, `REPORT_DAILY_LIMIT`, `COMMIT_LOOKUP_DAILY_LIMIT`, `MAX_PENDING_SUBMISSIONS`, `STALE_SUBMISSION_MINUTES`, `EMAIL_FROM_ADDRESS`, `FEEDBACK_TABLES_ENDPOINT` | Bicep |
| `GITHUB_APP_PRIVATE_KEY` | Key Vault `GITHUB-APP-PRIVATE-KEY` (the Imagile Bot App) |
| `TURNSTILE_SECRET` | Key Vault `TURNSTILE-SECRET` |
| `SMOKE_TEST_KEY` | Key Vault `SMOKE-TEST-KEY` (made by `infra/bootstrap.sh` if missing) |
| `ACS_CONNECTION_STRING` | Key Vault `ACS-CONNECTION-STRING` (`imagile-comms`, sending as `no-reply@imagile.dev`) |
| `WEBHOOK_SECRET` | Key Vault `TOIL-WEBHOOK-SECRET` (made by `infra/bootstrap.sh`, below) |
| `REDACT_TERMS` | Key Vault `FEEDBACK-REDACT-TERMS`: the maintainer's copy of the `REDACT_TERMS` repository secret, which can't be read back (set by hand, below). Until it exists, the built-in rules only |

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
| 2 | Deploy identity: the `toil-feedback-deploy` app registration and service principal; federated credentials for the `feedback` environment in both subject forms GitHub issues, the name-based `repo:imagile-dev/toil:environment:feedback` and the ID-based one this repository uses now (`repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:feedback`), read at run time from the repository's OIDC customization API and its IDs from the API, never written here; the `feedback` environment; and the `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` repository variables |
| 3 | Its roles: Contributor on the resource group; Role Based Access Control Administrator there, limited by a condition to granting or removing Storage Blob Data Owner and Storage Table Data Contributor; Cost Management Reader on the subscription (the deploy's cost gate); Monitoring Reader on the `ag-cost-email` action group in `rg-alerts` alone, which the alert rules link to |
| 4 | `id-toil-feedback-kv`, a user-assigned identity with Key Vault Secrets User on `imagile-keyvault`, which `infra/main.bicep` attaches to the app for its Key Vault references, so they resolve on the first deploy |
| 5 | `SMOKE-TEST-KEY`, if missing (a random value), and Key Vault Secrets User on that one secret for the deploy identity (the smoke test reads it) |
| 6 | `TOIL-WEBHOOK-SECRET`, if missing, and the repository webhook to `/api/webhook/issue` (Issues only, JSON) signed with it, if missing |
| 7 | Read only: `FEEDBACK-REDACT-TERMS` exists (only its presence is read, never its value) |
| 8 | Read only: the Imagile Bot App has Issues, Contents and Pull requests write, and no Workflows |
| 9 | Read only: `imagile.dev` is verified and linked to Communication Services |

Two steps stay with the maintainer, and the script ends by printing them:

1. **Turnstile hostname.** Add `imagile-dev.github.io` to the hostnames of the
   existing Turnstile widget in Cloudflare (the site key in `site/src/data/feedback.ts`).
2. **The denylist.** The private list of organization names both redactors use, one
   entry per line (see `scripts/triage/redact.mjs`), stored twice from the same file:
   `gh secret set REDACT_TERMS --repo imagile-dev/toil < terms.txt` for triage, and
   `az keyvault secret set --vault-name imagile-keyvault --name FEEDBACK-REDACT-TERMS --file terms.txt --output none`
   for the function. Keep the two the same. Both run without it, with only the built-in
   rules. The function picks up a change within a day, or at once after
   `az functionapp restart --resource-group rg-toil-feedback --name func-toil-feedback`.

## Develop

```bash
npm ci --ignore-scripts
npm run typecheck
npm test            # every edge is a fake: tables in memory, GitHub, Turnstile and ACS stubbed
npm run build       # tsc, then scripts/copy-shared.mjs: the shared redaction modules, and a check that they load
```

To run it locally, copy `local.settings.json.example` to `local.settings.json`,
start Azurite, point `GITHUB_API_URL` at a local stand-in for GitHub (never the real
App key), and run `npm start` (Azure Functions Core Tools).
