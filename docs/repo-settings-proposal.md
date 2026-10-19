# Repository settings proposal

A proposal for the settings of `imagile-dev/toil`, for the maintainer to accept,
change or turn down item by item. Nothing here has been applied: every setting below
was read with read-only `gh api` calls on 2026-10-19, and every command is for the
maintainer to run. This file changes nothing on its own.

Each item gives the current value, the proposed value, why, the risk or trade-off,
and how to apply it. Items are in priority order, and anything that touches the
existing automation says so under **Automation**. The automation it was checked
against:

- **The review loop.** `claude-review.yml` reviews every same-repo PR as the Imagile
  Bot App (`imagile-bot[bot]`) and submits a formal `APPROVE` or
  `REQUEST_CHANGES`; the `ship` skill fixes findings, resolves threads and posts
  `<!-- toil-feedback-round -->` markers.
- **Releases.** `release.yml` runs release-please with an Imagile Bot App token on
  every push to `main` (while `TOIL_RELEASES` is `on`). The App opens the release PR,
  pushes the rebuilt `dist/` to it, and on merge creates the tags `v*` and
  `toil-ui-v*` and their GitHub releases. `publish-toil` and `publish-ui` then publish
  to npm with `NPM_TOKEN` and `--provenance`, and upload the tarball to the existing
  release.
- **Triage.** `triage.yml` claims, redacts and triages `from-website`,
  `from-terminal` and `claude-triage` issues, and opens draft PRs as the App.
- **Deploys.** `pages.yml` deploys the site through the `github-pages` environment;
  `feedback-deploy.yml` deploys the feedback function to Azure over OIDC through the
  `feedback` environment.

The commands assume `gh` is signed in as a repository admin, and a bash-compatible
shell (Git Bash or WSL on Windows), because the JSON bodies are bash heredocs passed
on stdin with `--input -`.

## Summary

| # | Item | Priority | Breaks automation if done wrong |
|---|------|----------|---------------------------------|
| 1 | Private vulnerability reporting on | High | No |
| 2 | Secret scanning and push protection on | High | No (test fixtures may need a bypass) |
| 3 | `feedback` environment limited to `main` | High | Feedback deploy, if the branch name is wrong |
| 4 | Main ruleset: stale-review dismissal, last-push approval, thread resolution, linear history | High | Review loop, if the bot stops re-reviewing |
| 5 | Tag ruleset for `v*` and `toil-ui-v*` | High | Releases, if creation is restricted without the App bypass |
| 6 | Description, homepage and topics | High | No |
| 7 | Social preview image | Medium | No |
| 8 | Actions: SHA pinning required, allowed actions listed | Medium | Every workflow, if a used action is missing from the list |
| 9 | Actions: approval for every outside contributor's workflow run | Medium | No |
| 10 | CodeQL default setup | Medium | No |
| 11 | `npm-publish` environment, then trusted publishing instead of `NPM_TOKEN` | Medium | Releases; needs a workflow change first |
| 12 | Merge settings: squash only, PR title as the commit title, update-branch button | Medium | release-please, if titles stop being Conventional |
| 13 | Dependabot security updates | Medium (decision) | No, but clashes with the 14-day rule |
| 14 | Signed commits on `main` | Low (decision) | No |
| 15 | Merge queue | Low (later) | CI, until `ci.yml` handles `merge_group` |
| 16 | Wiki and Projects off | Low | No |
| 17 | Discussions | Low (decision) | No |
| 18 | CODEOWNERS | Low | Every merge, if code-owner review is required |
| 19 | "Allow GitHub Actions to create and approve pull requests" stays off | Keep | Nothing needs it |
| 20 | Immutable releases stay off for now | Keep | Releases, if turned on today |
| 21 | Organization: require two-factor authentication | Low (org) | No |

## High priority

### 1. Private vulnerability reporting

- **Current:** off (`{"enabled":false}`).
- **Proposed:** on.
- **Why:** `.github/SECURITY.md` sends reporters to
  <https://github.com/imagile-dev/toil/security/advisories/new>, which only works with
  this on. Without it, the only channels are a public issue or the feedback form,
  which also creates a public issue.
- **Risk:** none. Reports go to repository admins and security managers only.
- **Apply:** `gh api -X PUT repos/imagile-dev/toil/private-vulnerability-reporting`,
  or Settings → Code security → Private vulnerability reporting → Enable.

### 2. Secret scanning and push protection

- **Current:** `secret_scanning`, `secret_scanning_push_protection`,
  `secret_scanning_non_provider_patterns` and `secret_scanning_validity_checks` all
  `disabled`.
- **Proposed:** secret scanning and push protection on. Non-provider patterns and
  validity checks on if the plan offers them for this repository.
- **Why:** toil handles tokens for two dozen services, and agents push to this
  repository many times a day. Push protection stops a real token before it lands,
  which matters more here than in most repositories, since a pushed secret in a public
  repository is harvested within minutes. Both are free for public repositories.
- **Risk:** the redaction and secret-scan tests (`test/triage.test.ts`,
  `scripts/triage/redact.mjs`, `src/core/secret-shapes.ts`,
  `src/areas/util/size.test.ts`) hold token-shaped strings on purpose. Existing ones
  may raise alerts to close as "used in tests"; a new one in a later PR is blocked at
  push until the pusher picks "It's used in tests". An agent can't answer that prompt,
  so the maintainer may need to approve the bypass for an agent's push.
- **Automation:** none of the workflows push token-shaped text.
- **Apply:**

  ```bash
  gh api -X PATCH repos/imagile-dev/toil --input - <<'EOF'
  {"security_and_analysis": {
    "secret_scanning": {"status": "enabled"},
    "secret_scanning_push_protection": {"status": "enabled"},
    "secret_scanning_non_provider_patterns": {"status": "enabled"},
    "secret_scanning_validity_checks": {"status": "enabled"}
  }}
  EOF
  ```

  If the last two are refused for the plan, drop them and send the first two. Or
  Settings → Code security → Secret Protection.

### 3. Limit the `feedback` environment to `main`

- **Current:** `feedback` has no protection rules and no deployment branch policy
  (`"deployment_branch_policy": null`), so a job on any branch that names the
  environment gets it. `github-pages` already has a custom branch policy.
- **Proposed:** deployment branches limited to `main`. No required reviewers.
- **Why:** the deploy job gets an Azure token over OIDC through this environment. If
  the Azure federated credential trusts `environment:feedback` (the usual subject for
  an environment job), a workflow pushed to any branch of this repository could name
  the environment and deploy, or do anything the deploy identity can. Limiting it to
  `main` means only reviewed code can get that token. Required reviewers would stop
  the automatic deploy and its smoke test after every merge, so the branch policy is
  the better trade.
- **Risk:** low. The deploy job already runs only on `main`
  (`github.ref == 'refs/heads/main'`).
- **Automation:** feedback deploy. Use the exact name `main`.
- **Also check:** the federated credential's subject in Azure (Entra ID → App
  registrations → the deploy app → Certificates & secrets → Federated credentials).
  It should be `repo:imagile-dev/toil:environment:feedback`, not a branch or
  `pull_request` subject.
- **Apply:**

  ```bash
  gh api -X PUT repos/imagile-dev/toil/environments/feedback --input - <<'EOF'
  {"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
  EOF
  gh api -X POST repos/imagile-dev/toil/environments/feedback/deployment-branch-policies \
    -f name=main -f type=branch
  ```

  Or Settings → Environments → feedback → Deployment branches and tags → Selected
  branches and tags → Add `main`.

### 4. The `main` ruleset

- **Current** (ruleset `default`, id 25274548, active on `~DEFAULT_BRANCH`):
  - deletion and force pushes (`non_fast_forward`) blocked
  - pull request required: 1 approval, `dismiss_stale_reviews_on_push: false`,
    `require_last_push_approval: false`, `required_review_thread_resolution: false`,
    `require_code_owner_review: false`, merge methods `squash` only
  - required status check `CI ok` (GitHub Actions, integration id 15368), not strict
  - no bypass actors; the maintainer can't bypass either
- **Proposed:** keep all of that and add:
  - **Dismiss stale approvals on push.** An approval counts only for the commit it
    approved. The review workflow already re-reviews on every `synchronize`, so the
    bot approves again at the new head.
  - **Require approval of the most recent push.** Whoever pushed last can't be the
    approver. On the maintainer's PRs the bot approves; on the bot's release and
    triage PRs the maintainer does. Nothing changes for either.
  - **Require conversation resolution.** The `ship` skill already resolves the
    threads it fixes and leaves disagreements open for the maintainer; this makes
    that the gate rather than a habit.
  - **Require linear history.** Squash is already the only merge method, so this only
    states it.
  - **Required checks: `CI ok` only, still not strict.** `CI ok` already depends on
    every gate job (each OS and Node version), the database integration job and the
    `dist/` guard. Don't add the per-OS names (they change with the Node version), the
    review job (approval covers it, and it skips the release PR), `skill install`, or
    the path-filtered `build` (Pages) and `Function build and tests` (feedback deploy),
    which would block every PR they don't run on. Strict ("branch up to date") would
    make every merge re-run the full matrix on three OSes; a merge queue (item 15) is
    the better answer if two green PRs ever break `main` together.
  - **Bypass list stays empty.** An admin can still edit the ruleset in an emergency,
    and that edit is in the audit log.
- **Risk:** stale dismissal and last-push approval mean a PR that is approved and then
  updated (for example by "Update branch", or a merge from `main`) needs a fresh
  approval. The bot gives it automatically on same-repo PRs; on the release PR the
  maintainer approves after the last `dist/` push, which is the review it already
  needs.
  Once the fix agent (`claude-pr-feedback.yml`) pushes to PR branches as the App, a
  PR it fixed needs a human approval, because the App can't approve its own last
  push. That is likely what you want, an agent never approving its own fix into
  `main`, but it will look like the loop stalled unless you expect it.
- **Automation:** review loop and release PR, as above. If the review workflow is ever
  off or broken, nothing merges, which is the intent.
- **Apply** (a PUT replaces the whole ruleset, so this repeats what's kept):

  ```bash
  gh api -X PUT repos/imagile-dev/toil/rulesets/25274548 --input - <<'EOF'
  {
    "name": "default",
    "target": "branch",
    "enforcement": "active",
    "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
    "bypass_actors": [],
    "rules": [
      {"type": "deletion"},
      {"type": "non_fast_forward"},
      {"type": "required_linear_history"},
      {"type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": true,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }},
      {"type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{"context": "CI ok", "integration_id": 15368}]
      }}
    ]
  }
  EOF
  ```

  The current ruleset also carries `require_extra_approval_for_unattributed_changes:
  true`. Check that it survives the PUT with
  `gh api repos/imagile-dev/toil/rulesets/25274548`, and add it to the
  `pull_request` parameters if it doesn't. Or Settings → Rules → Rulesets → default.

### 5. A tag ruleset for release tags

- **Current:** no tag rulesets (`gh api "repos/imagile-dev/toil/rulesets?targets=tag"`
  returns `[]`). Tags `v0.1.0-alpha.1` and `v0.1.0-alpha.2` exist; `toil-ui-v*` tags
  start with the first Toil UI release.
- **Proposed:** a ruleset on `refs/tags/v*` and `refs/tags/toil-ui-v*` that blocks
  updating and deleting a tag. Optionally, also restrict creating one, with the
  Imagile Bot App as the only bypass actor.
- **Why:** each tag is what a published npm version was built from (the publish jobs
  check it out, and provenance points at it). A moved or deleted tag makes that record
  untrue.
- **Risk:** blocking update and deletion has no effect on release-please, which only
  ever creates tags. Restricting creation does: release-please creates the tag through
  the App when it creates the release, so without the App in the bypass list the
  release fails after the release PR merges, with nothing tagged or published. Start
  with update and deletion; add creation only together with the bypass, and watch the
  next release.
- **Automation:** releases.
- **Apply** (update and deletion only):

  ```bash
  gh api -X POST repos/imagile-dev/toil/rulesets --input - <<'EOF'
  {
    "name": "release tags",
    "target": "tag",
    "enforcement": "active",
    "conditions": {"ref_name": {"include": ["refs/tags/v*", "refs/tags/toil-ui-v*"], "exclude": []}},
    "bypass_actors": [],
    "rules": [{"type": "update"}, {"type": "deletion"}, {"type": "non_fast_forward"}]
  }
  EOF
  ```

  To restrict creation as well, add `{"type": "creation"}` to `rules` and set
  `bypass_actors` to the App, whose ID is in the `IMAGILE_BOT_APP_ID` variable
  (`gh variable get IMAGILE_BOT_APP_ID --repo imagile-dev/toil`):
  `[{"actor_id": <app id>, "actor_type": "Integration", "bypass_mode": "always"}]`.
  Or Settings → Rules → Rulesets → New tag ruleset.

### 6. Description, homepage and topics

- **Current:** description "One CLI and MCP server for enterprise tools, databases,
  and codebases"; homepage none; no topics.
- **Proposed:**
  - description: "The token-efficient alternative to MCP: one CLI and MCP server for
    your enterprise tools and databases. Plain JavaScript on Node, nothing to install
    but the package."
  - homepage: <https://imagile-dev.github.io/toil/>
  - topics: `cli`, `mcp`, `mcp-server`, `model-context-protocol`, `ai-agents`,
    `agent-skills`, `developer-tools`, `enterprise`, `json`, `nodejs`, `typescript`,
    `jira`, `confluence`, `bitbucket`, `sonarqube`, `jenkins`, `artifactory`,
    `database`, `postgresql`, `sql-server` (20, GitHub's limit)
- **Why:** the description is the line under the name in search results and link
  previews, and topics are how people browsing `mcp-server` or `developer-tools` find
  the repository. The homepage puts the site's link in the About panel.
- **Risk:** none.
- **Apply:**

  ```bash
  gh repo edit imagile-dev/toil \
    --description "The token-efficient alternative to MCP: one CLI and MCP server for your enterprise tools and databases. Plain JavaScript on Node, nothing to install but the package." \
    --homepage https://imagile-dev.github.io/toil/ \
    --add-topic cli,mcp,mcp-server,model-context-protocol,ai-agents,agent-skills,developer-tools,enterprise,json,nodejs \
    --add-topic typescript,jira,confluence,bitbucket,sonarqube,jenkins,artifactory,database,postgresql,sql-server
  ```

## Medium priority

### 7. Social preview

- **Current:** none (GitHub's generated card).
- **Proposed:** `.github/assets/social-preview.png`, added in this PR: 1280×640 PNG,
  277 KB, the toil mark, the wordmark and the one-line pitch on the site's drafting art.
- **Why:** it's the image every shared link to the repository shows on chat, social
  and in search.
- **Risk:** none. It isn't settable through the API.
- **Apply:** Settings → General → Social preview → Edit → Upload an image… → pick
  `.github/assets/social-preview.png`.

### 8. Actions: require SHA pins, and list the allowed actions

- **Current:** `allowed_actions: all`, `sha_pinning_required: false`.
- **Proposed:** `sha_pinning_required: true`, and `allowed_actions: selected` with
  GitHub-owned actions plus exactly the three third-party ones in use.
- **Why:** every `uses:` in the eight workflows is already pinned to a full commit
  SHA (the `automation` skill requires it), so the setting enforces what is already
  true and makes a tag-pinned action fail at once instead of passing review. The
  allowlist stops a new third-party action, from an agent's PR for example, from
  running before someone has decided to trust it. The ones in use today:
  `actions/checkout`, `actions/setup-node`, `actions/create-github-app-token`,
  `actions/upload-artifact`, `actions/download-artifact`,
  `actions/upload-pages-artifact`, `actions/deploy-pages` (all GitHub-owned),
  `anthropics/claude-code-action`, `googleapis/release-please-action` and
  `azure/login`.
- **Risk:** adding a new action means updating the list first. Reusable workflows and
  local actions (`./…`) aren't used here.
- **Automation:** all of it. Check the list against
  `grep -h "uses:" .github/workflows/*.yml` before applying.
- **Apply:**

  ```bash
  gh api -X PUT repos/imagile-dev/toil/actions/permissions \
    -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
  gh api -X PUT repos/imagile-dev/toil/actions/permissions/selected-actions --input - <<'EOF'
  {"github_owned_allowed": true, "verified_allowed": false,
   "patterns_allowed": ["anthropics/claude-code-action@*", "googleapis/release-please-action@*", "azure/login@*"]}
  EOF
  ```

  Or Settings → Actions → General → Actions permissions.

### 9. Actions: approval for outside contributors' workflow runs

- **Current:** `approval_policy: first_time_contributors`.
- **Proposed:** `all_external_contributors`.
- **Why:** under the current policy, someone whose first PR was merged (a typo fix)
  gets workflows on every later fork PR with no approval. Fork runs get no secrets and
  a read-only token, and the review job already skips forks, but CI still runs their
  code on all three OSes. Approving each outside run is cheap at this volume.
- **Risk:** a maintainer clicks "Approve and run" for each outside PR. Same-repo PRs,
  including every agent's, are unaffected.
- **Apply:**
  `gh api -X PUT repos/imagile-dev/toil/actions/permissions/fork-pr-contributor-approval -f approval_policy=all_external_contributors`,
  or Settings → Actions → General → Approval for running fork pull request workflows
  from contributors.

### 10. CodeQL code scanning

- **Current:** default setup `not-configured`; GitHub detects `actions` and
  `javascript-typescript`.
- **Proposed:** default setup on, for both languages, default query suite.
- **Why:** the `actions` queries look for exactly the mistakes this repository's
  agent workflows have to avoid (untrusted input in `run:`, over-broad tokens), and
  the JavaScript queries cover the code that handles credentials and paths. Free for
  public repositories.
- **Risk:** a few findings to triage at first. Don't make it a required check;
  results appear on PRs either way.
- **Apply:**
  `gh api -X PATCH repos/imagile-dev/toil/code-scanning/default-setup -f state=configured -f query_suite=default`,
  or Settings → Code security → Code scanning → CodeQL analysis → Set up → Default.

### 11. An `npm-publish` environment, then trusted publishing

- **Current:** `publish-toil` and `publish-ui` use the repository secret `NPM_TOKEN`,
  readable by every workflow on every branch. They already publish with
  `--provenance` (the npm registry shows SLSA provenance for `0.1.0-alpha.2`). There
  is no environment for them.
- **Proposed,** in order:
  1. An environment `npm-publish`, deployment branches limited to `main`, and the
     maintainer as a required reviewer. Branches, not tags: `release.yml` runs on a
     push to `main`, so the job's ref is `refs/heads/main` even though it checks out
     the tag.
  2. A workflow PR that adds `environment: npm-publish` to both publish jobs. This is
     a functional change, so it isn't part of this proposal's PR.
  3. `NPM_TOKEN` moved from a repository secret to an environment secret on
     `npm-publish`, so only those two jobs can read it.
  4. Trusted publishing configured on npmjs.com for `@imagile-dev/toil` (package →
     Settings → Trusted publishing → GitHub Actions: organization `imagile-dev`,
     repository `toil`, workflow `release.yml`, environment `npm-publish`), and for
     `@imagile-dev/toil-ui` once its first version exists on npm.
  5. Once a release has gone out over OIDC: the package's Publishing access set to
     "Require two-factor authentication and disallow tokens", and `NPM_TOKEN` deleted.
- **Why:** a stolen or leaked `NPM_TOKEN` publishes anything; a trusted publisher
  accepts only this repository's `release.yml` in that environment. The required
  reviewer means a compromised workflow on `main` still can't publish without a
  person clicking Approve.
- **Risk:**
  - The reviewer adds a second click after merging the release PR, and the publish
    waits until it's given. Releases are rare, so it's cheap.
  - The "move `latest`" step runs `npm dist-tag add`, which needs a token unless the
    trusted publisher has **Allow npm dist-tag** on and npm is 11.21 or later; the
    workflow installs npm 11.5.1. Until that changes, dropping the token turns that
    step into its warning. The workflow's own comments say the same.
  - npm can't set up a trusted publisher for a package that doesn't exist yet, so
    `@imagile-dev/toil-ui`'s first publish still needs the token.
- **Automation:** releases. Do steps 1 and 2 together, and 4 before 5.
- **Apply** (step 1):

  ```bash
  gh api -X PUT repos/imagile-dev/toil/environments/npm-publish --input - <<EOF
  {"reviewers": [{"type": "User", "id": $(gh api users/kolatts --jq .id)}],
   "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
  EOF
  gh api -X POST repos/imagile-dev/toil/environments/npm-publish/deployment-branch-policies \
    -f name=main -f type=branch
  ```

  Step 3: `gh secret set NPM_TOKEN --repo imagile-dev/toil --env npm-publish`, then
  `gh secret delete NPM_TOKEN --repo imagile-dev/toil` once the workflow change has
  merged.

### 12. Merge settings

- **Current:** merge commits, squash and rebase all allowed at the repository level
  (the ruleset narrows `main` to squash); squash title `COMMIT_OR_PR_TITLE`, message
  `COMMIT_MESSAGES`; auto-delete head branches on; auto-merge allowed;
  "Always suggest updating pull request branches" off.
- **Proposed:**
  - merge commits and rebase off, so the merge button offers only what the ruleset
    accepts
  - squash title `PR_TITLE`; message stays `COMMIT_MESSAGES`
  - "Always suggest updating pull request branches" on
  - auto-delete head branches stays on; auto-merge stays allowed (a person still
    turns it on per PR, and the ruleset still needs the approval and `CI ok`)
- **Why:** release-please reads the squash commit's title. With
  `COMMIT_OR_PR_TITLE`, a one-commit PR's title comes from its commit, not from the
  PR title the review checked. `PR_TITLE` makes the reviewed title the changelog
  entry every time. The message isn't set to `PR_BODY` on purpose: a description that
  mentions "BREAKING CHANGE" in prose would land in the commit body, where
  release-please reads it as a breaking-change footer.
- **Risk:** low. A PR title that isn't a Conventional Commit becomes a commit
  release-please ignores, as it would today.
- **Automation:** release-please.
- **Apply:**

  ```bash
  gh api -X PATCH repos/imagile-dev/toil \
    -F allow_merge_commit=false -F allow_rebase_merge=false -F allow_squash_merge=true \
    -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=COMMIT_MESSAGES \
    -F allow_update_branch=true -F delete_branch_on_merge=true
  ```

  Or Settings → General → Pull Requests.

### 13. Dependabot (the maintainer's decision)

- **Current:** Dependabot alerts on (`vulnerability-alerts` returns 204, no open
  alerts); security updates off; no `.github/dependabot.yml`.
- **Proposed:** keep alerts on. Security updates are a decision:
  - **Off (the recommendation).** CLAUDE.md requires every dependency to be at least
    14 days old when added or bumped, and pinned exactly. Security-update PRs propose
    the fixed version at once, and they're authored by `dependabot[bot]`, which the
    review workflow skips, so each needs a person's review. Handle alerts by hand
    instead, waiving the 14 days only when the alert is worth it.
  - **On**, with a written exception to the 14-day rule for security fixes.
  - Separately, a `.github/dependabot.yml` for the `github-actions` ecosystem with
    `cooldown: { default-days: 14 }` would keep the SHA pins current under the same
    rule. That file is configuration, so it's proposed here, not added.
- **Risk:** with updates off, a fix waits for a person.
- **Apply (if on):** `gh api -X PUT repos/imagile-dev/toil/automated-security-fixes`.

## Low priority

### 14. Signed commits on `main` (the maintainer's decision)

- **Current:** not required.
- **Proposed:** yes, but it's close to free and close to redundant, so it's the
  maintainer's call.
- **Why yes:** with squash as the only merge method, every commit on `main` is made
  by GitHub and signed with its key, so the rule passes today with no one setting up
  a key. It would stop any future path that writes unsigned commits to `main`.
- **Why it adds little:** direct pushes to `main` are already impossible (a PR is
  required and nobody can bypass), release-please never pushes to `main`, and the
  rule says nothing about who wrote a PR's commits, only that GitHub signed the
  squash.
- **Risk:** it rules out rebase merging for good, and any tool that later pushes to
  `main` directly would need a signing key.
- **Apply:** add `{"type": "required_signatures"}` to the `rules` in item 4.

### 15. Merge queue (later)

- **Current:** off.
- **Proposed:** not yet. Revisit if two PRs that were green on their own ever break
  `main` together, which grows likelier with several agents merging in a day.
- **Why not now:** a queue runs required checks on `merge_group` events, and
  `ci.yml` only listens for `pull_request` and `push`, so `CI ok` would never report
  in the queue and nothing would merge. Turning it on needs `merge_group:` added to
  `ci.yml` first.
- **Apply (later):** add `{"type": "merge_queue", "parameters": {"merge_method":
  "SQUASH", "grouping_strategy": "ALLGREEN", "max_entries_to_build": 5,
  "min_entries_to_merge": 1, "max_entries_to_merge": 5,
  "min_entries_to_merge_wait_minutes": 5, "check_response_timeout_minutes": 60}}`
  to item 4's rules, after the workflow change.

### 16. Wiki and Projects off

- **Current:** `has_wiki: true` (the wiki has no pages: its git repository doesn't
  exist yet), `has_projects: true` (couldn't check for projects: the token used here
  lacks `read:project`).
- **Proposed:** wiki off. Projects off unless a project board is in use.
- **Why:** the docs live in `skills/toil/` and render on the site; an empty wiki tab
  is a second, unmaintained place to look, and anyone with write access could start
  filling it.
- **Apply:** `gh repo edit imagile-dev/toil --enable-wiki=false --enable-projects=false`.

### 17. Discussions (the maintainer's decision)

- **Current:** off.
- **Proposed:** keep off for now.
- **Why:** questions and ideas already have two routes, the feedback page (redacted,
  triaged within a daily cap) and the issue forms. Discussions would be a third,
  public, unredacted channel that triage doesn't watch, and people at locked-down
  employers tend to paste internal detail into questions. Turn it on when there's
  someone to answer there; then add a contact link to
  `.github/ISSUE_TEMPLATE/config.yml`.
- **Apply (if on):** `gh repo edit imagile-dev/toil --enable-discussions`.

### 18. CODEOWNERS

- **Current:** none.
- **Proposed:** optional, and never with "Require review from Code Owners".
  A file of `* @kolatts` would request the maintainer's review on every PR, triage's
  draft PRs included.
- **Risk:** requiring code-owner review would stop every merge. The only code owner
  would be the maintainer, an App can't be a code owner, and nobody can approve their
  own PR, so the maintainer's own PRs could never merge. Add the file for review
  requests only, or wait for a second maintainer.
- **Apply:** a one-line `.github/CODEOWNERS` in its own PR.

### 19. Keep "Allow GitHub Actions to create and approve pull requests" off

- **Current:** off (`can_approve_pull_request_reviews: false`), and the default
  `GITHUB_TOKEN` permission is already read-only (`default_workflow_permissions:
  read`).
- **Proposed:** keep both.
- **Checked:** nothing needs the setting. release-please opens the release PR with
  the Imagile Bot App's token; the review workflow approves as the App; triage opens
  its draft PRs as the App. The setting gates `GITHUB_TOKEN` only.

### 20. Keep immutable releases off, for now

- **Current:** off (`{"enabled": false}`).
- **Proposed:** keep off until the release flow changes.
- **Why:** an immutable release can't gain assets after it's published, and both
  publish jobs upload the npm tarball to the release (`gh release upload`) after
  release-please has published it. Turning this on today makes that step fail on
  every release. It becomes worth having once release-please creates draft releases
  and the publish job publishes the release after uploading.

### 21. Organization: require two-factor authentication

- **Current:** `two_factor_requirement_enabled: false` on the `imagile-dev`
  organization.
- **Proposed:** on.
- **Why:** an organization account without 2FA is the easiest way to everything
  above, rulesets included.
- **Risk:** members without 2FA are removed from the organization when it's turned
  on, so check the member list first.
- **Apply:** Organization settings → Authentication security → Require two-factor
  authentication.

## Decisions for the maintainer

- Signed commits on `main` (item 14).
- Discussions (item 17).
- Dependabot security updates against the 14-day rule (item 13).
- A required reviewer on `npm-publish` (item 11).
- `FUNDING.yml`: not added. Nothing in the repository mentions sponsorship, so it's
  for the maintainer to decide whether toil takes any.
