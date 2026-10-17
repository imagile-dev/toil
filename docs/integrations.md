# Integrations

The enterprise services toil will cover. Each one is its own command area
(`toil <area> <verb>`) and must clear the Authentication Bar in the `integrations` skill
(`.claude/skills/integrations/SKILL.md`). Every one starts at verification level
`unit` (see the same skill).

## Work tracking and source

| Area | Service | Covers | Credential |
|------|---------|--------|------------|
| `jira` | Jira Data Center | Issues, sprints, boards, projects, transitions, comments | Personal access token |
| `ado` | Azure DevOps Server | Work items, repos, pull requests, pipelines | Personal access token |
| `bitbucket` | Bitbucket Data Center | Repositories, pull requests, comments, builds | HTTP access token |
| `github` | GitHub / GitHub Enterprise Server | Pull requests, reviews, issues, checks | Fine-grained PAT (`GITHUB_TOKEN` fallback) |
| `confluence` | Confluence Data Center | Pages, spaces, search, attachments | Personal access token |
| `git` | Local git | Status, diff, log, branch, current PR | None (local, pure JS) |

## Build, release and runtime

| Area | Service | Covers | Credential |
|------|---------|--------|------------|
| `jenkins` | Jenkins | Jobs, builds, console logs, queue | API token |
| `artifactory` | JFrog Artifactory | Repositories, artifact search, package versions, licenses | Access token |
| `openshift` | OpenShift / Kubernetes | Pods, events, logs, metrics, deployments | Service account token |
| `splitio` | Split.IO | Feature flags, environments, change requests | Admin API key |
| `saucelabs` | Sauce Labs | Test jobs, builds, real devices | Access key |

## Security and quality

| Area | Service | Covers | Credential |
|------|---------|--------|------------|
| `sonar` | SonarQube | Quality gates, issues, hotspots, measures | User token (`SONAR_TOKEN` fallback) |
| `checkmarx` | Checkmarx One | SAST scans, results, projects | API key, exchanged over HTTP for an access token |
| `contrast` | Contrast Security IAST | Applications, vulnerabilities, routes | API key + service key |
| `sonatypeiq` | Sonatype IQ Server | Applications, policy evaluations, violations, waivers | User token pair |
| `sde` | SD Elements | Projects, countermeasures, security requirements | API token |

## Observability

| Area | Service | Covers | Credential |
|------|---------|--------|------------|
| `dynatrace` | Dynatrace | Problems, entities, traces, metrics | API token |
| `logscale` | Falcon LogScale | Log queries, repositories, saved searches | API token |
| `elasticsearch` | Elasticsearch | Search, count, indices, cluster health | API key |
| `kibana` | Kibana | Dashboards, data views, alerting rules | API key (shared with Elasticsearch) |

## Design and data

| Area | Service | Covers | Credential |
|------|---------|--------|------------|
| `figma` | Figma | Files from a link, comments, version history | Personal access token |
| `alation` | Alation | Catalog metadata, search, documents | Refresh token, exchanged over HTTP for an API token |

## Dependency analysis: one source per command

No command fans out to several vulnerability sources on the caller's behalf. Each
source has its own command, and they compose through one local inventory. The `deps`
commands keep the shape listed in [command-contract.md](command-contract.md).

| Command | Source | Covers | Network |
|---------|--------|--------|---------|
| `toil deps scan` | Local manifests | Package inventory for npm, Maven and NuGet | None |
| `toil deps diff` | Local manifests | Packages added, removed or changed between two refs | None |
| `toil osv vulns` | OSV.dev | Known vulnerabilities for an inventory | Public API, no credential |
| `toil ossindex vulns` | Sonatype OSS Index | Known vulnerabilities for an inventory | Public API, optional token |
| `toil sonatypeiq evaluate` | Sonatype IQ Server | Policy evaluation of an inventory against an application | User token pair |
| `toil deps frisk --source <one>` | Whichever source you name | Alias for the matching command above | As above |
| `toil deps outdated` | JFrog Artifactory | Newer versions available in your mirrors | Access token |
| `toil deps license-check` | JFrog Artifactory | License metadata for an inventory | Access token |

Each source command reads an inventory from `--from <file>` or stdin, so
`toil deps scan | toil osv vulns` works. Any of them can also be pointed at a repo
directly, in which case it runs the scan itself. Reachability checks belong to each
source's `config test`, not to a separate connectivity command.

## Local utilities

| Command | Covers |
|---------|--------|
| `toil jwt decode` | Decode a JWT's header and claims without verifying |
| `toil doctor` | Config, credential and reachability report across every configured area |
| `toil config` | `init`, `set`, `check`, `test`, keychain references |
| `toil skills` | Install the user-facing skill for an agent |

## Not planned

| Service | Why |
|---------|-----|
| ServiceNow | Personal access tokens are opt-in and usually disabled, so in practice auth falls back to username + password |
| IBM UrbanCode Deploy | No standalone personal token; the only workable auth is an account password |

## Order

Areas are built in vertical slices: databases and code intelligence first, then
dependency analysis (it exercises the composition pattern), then work tracking, then
the rest roughly in order of daily use.
