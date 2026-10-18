---
name: automation
description: Rules for the repository's agent automation under .github/ (the PR review agent, the fix agent that pushes to PR branches, Discord notifications, issue triage and redaction). Use when editing or reviewing any GitHub Actions workflow, especially one that runs an agent or holds a token: its labels (`no-auto-fix`, `needs-human`), reviewer and bot allowlists, token permissions, action SHA pins, the Imagile Bot App token, Discord webhook posts, or the `REDACT_TERMS` redaction of externally filed issues.
---

# Automation

An agent reviews every PR and submits a formal review. `CHANGES_REQUESTED` dispatches
a fix agent that pushes to the PR branch. A human merges every PR, including the
release PR; no agent merges, approves its own work into `main`, or enables auto-merge.

- **The review** is `.github/workflows/claude-review.yml`. It runs on same-repo,
  non-draft PRs from humans and `claude[bot]`, authenticated by the
  `CLAUDE_CODE_OAUTH_TOKEN` secret.
  - It acts as the **Imagile Bot GitHub App** (`imagile-bot[bot]`), with a token
    minted per run from the `IMAGILE_BOT_APP_ID` variable and the
    `IMAGILE_BOT_PRIVATE_KEY` secret. The token gets read-only contents plus
    pull-request and issue writes. The workflow's own `GITHUB_TOKEN` stays
    read-only. Formal APPROVE needs no extra repo setting, because that setting
    only gates `GITHUB_TOKEN`. The App can't approve its own PRs, so those are
    skipped.
  - It reviews against CLAUDE.md and the skills and can run the gate (`npm test`, `typecheck`,
    `lint`, `build`, `check:pure`), so findings are backed by inputs it ran.
  - A last step fails the job if no formal review by the bot landed on the head
    commit, so a silent agent can't read as green.
  - Subagents are disallowed, because in headless mode they get killed when the turn
    ends. Bash allow-rules with a mid-pattern `*` use the trailing-space form.
- **Every action is pinned to a full commit SHA**, with its version as a trailing
  comment (`uses: actions/checkout@<sha> # v4.4.0`), in every workflow. Tags can be
  moved after review; SHAs can't, and these jobs hold tokens. A new or bumped pin must
  be a release at least 14 days old, so a compromised release has time to be caught
  before it runs here with those tokens.
- **The fix agent** (`claude-pr-feedback.yml`) isn't wired yet. App-authored reviews
  raise `pull_request_review` events, so when it lands it triggers on a
  `CHANGES_REQUESTED` review from `imagile-bot[bot]` directly. That bot must be named
  in its reviewer allowlist and in `allowed_bots`, never `*`.

- `no-auto-fix` label: the fix agent leaves the PR alone. So does the `ship` skill's
  local watch.
- `needs-human` label: set after 3 pushed rounds; the loop stops. Rounds are counted
  from `<!-- toil-feedback-round -->` marker comments on the PR, which `ship` posts
  too. When the fix agent is wired, it counts and posts the same marker, so a PR has
  one limit across both loops. `ship` also sets `needs-human` when a PR stalls for an
  hour.
- Only `OWNER`/`MEMBER`/`COLLABORATOR` reviews and explicitly named bots trigger it.
  Never use `allowed_bots: "*"`.
- The fix agent never edits: `on:` triggers, actor allowlists, `permissions:`, token
  minting inputs, secrets, `uses:` pins, agent prompts and tool allowlists, or new
  `run:` steps in agent workflows. Agents do not edit the rules that constrain them.
- Externally filed issues are redacted (secrets, internal hosts, private IPs, org names
  from the `REDACT_TERMS` secret) before any agent reads them. The denylist lives only
  in that secret.

## Triage of issues filed from outside

Principle 2's one exception: issues filed from outside may be triaged by an agent,
but only after redaction, within the daily cap, under the safeguards below, and only
through PRs that a human merges. `.github/workflows/triage.yml` is that agent. It
starts on the `from-website` or `from-terminal` label (set by the feedback backend,
`functions/feedback/`, as the Imagile Bot), on `claude-triage` added by a
maintainer, on `workflow_dispatch` with an issue number, and on a daily schedule
for the queue. Only `imagile-bot` is accepted as a bot actor, in the job's `if` and
in `allowed_bots`.

- **The cap.** At most four issues a UTC day (`TRIAGE_CAP`), counted by
  `scripts/triage/cap.mjs`: a run claims its issue with `triage-claimed` and ranks
  today's claims by label-event id, so concurrent runs agree without a lock. The
  fifth gets `triage-queued`; the daily run drains the queue oldest first, along with
  anything a run missed. A manual dispatch is a re-triage and isn't counted.
- **Redaction first.** `scripts/triage/redact.mjs` rewrites the issue's title and
  body in place before the agent starts; the prompt fences them between
  `BEGIN/END UNTRUSTED <nonce>` lines with a nonce per run, and tells the agent to
  triage on the title alone when the body reads as an injection attempt.
- **No push from the agent's runner.** The agent's token has `issues: write` and
  `contents: read` only; its tool list has `git checkout -b`, `git add` and
  `git commit` but no `git push`, `gh pr` or web tools. Its commits leave as a git
  bundle artifact. A separate job on a fresh runner, which runs nothing the agent
  wrote, checks every changed path with `scripts/triage/changes.mjs` (one area's own
  files, regular files only), then pushes `claude/issue-<n>` and opens the PR with
  `Closes #<n>` and `from-triage`, with a token that has no `workflows` permission.
  Anything the agent ran (its gate runs its own tests) could reach the agent job's
  tokens; that is why they can't push.
- **Scope.** One area: `src/areas/<area>/`, its fixture, skill file, divergences,
  board entry, and the two generated site data files. Core, `functions/`, `infra/`,
  site pages, `.github/`, `scripts/`, `dist/`, `package.json`, the lockfile and new
  dependencies are maintainer work, denied with that explanation.
- **Model and turns are fixed:** `--model sonnet --max-turns 100`. Transient GitHub
  failures (5xx, 429, network) are retried. The triage summary goes to the job
  summary from `/tmp`, never the working tree.
- The PRs triage opens are authored by `imagile-bot[bot]`, so `claude-review.yml`
  skips them (the App can't approve its own PR); a maintainer reviews them.

## The feedback backend's deploy

`.github/workflows/feedback-deploy.yml` builds and tests `functions/feedback/` on
PRs with no Azure access. On `main` it logs in to Azure over OIDC (repository
variables, no stored secret), refuses to deploy when Azure's forecast for the month
is over the subscription's $50 cap, runs `what-if`, deploys `infra/main.bicep` and
the function, and ends with `functions/feedback/scripts/smoke.mjs`, which drives both
endpoints with the smoke-test key and waits for the runs on the one persistent
`smoke-test` issue. The smoke-test key is read from Key Vault at run time and masked.
Nothing it deploys may be always on; any change to `infra/` states its monthly cost
(CLAUDE.md, Cloud Cost).

## Discord

A Discord channel follows the project through one webhook, the `DISCORD_WEBHOOK`
repository secret. Without the secret, every notify step logs a skip and exits 0, so
forks and fresh clones never fail on it.

- `.github/workflows/discord-notify.yml` posts every issue as it opens and closes.
  Each post sets `username: toil` and its avatar from
  `https://imagile-dev.github.io/toil/brand/toil-avatar-512.png`, so moving or
  renaming that file breaks the bot's avatar.
- `.github/workflows/release.yml` posts each npm publish (version, release
  notes, npm link). It **also posts loudly when a publish fails**, because a silent
  publish failure is the one that goes unnoticed. Both steps are non-fatal:
  `|| echo "Discord notify failed (non-fatal)"`.
- Event text such as issue titles reaches the script through `env:` and goes into the
  payload with `jq --arg`, never by interpolating `${{ }}` into `run:`. An issue
  title is attacker-controlled.
