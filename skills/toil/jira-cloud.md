---
area: jira-cloud
description: Issues, JQL search, transitions, comments, labels, links, projects, users, boards and sprints on Jira Cloud
---

# Jira Cloud (`jira-cloud`)

Issues, JQL search, transitions, comments, labels, links, projects, users, boards
and sprints on **Jira Cloud** (`https://<site>.atlassian.net`, REST API 3 and the
Agile REST API 1.0). Built from Atlassian's API documentation and never run against
a live site. Verification level: `unit`.

For Jira Data Center or Server, use the `jira` area instead. The two are separate
areas because their APIs differ: Cloud names people by **accountId**, not username,
and its rich text is **Atlassian Document Format** (ADF), not a string.

**Supported versions:** The oldest Jira Cloud version toil supports hasn't been established. Jira
Cloud is always current. toil calls REST API 3 (`/rest/api/3`, with the enhanced JQL
search at `/rest/api/3/search/jql`) and the Agile REST API 1.0, with an Atlassian
account email and API token sent as Basic auth. Nothing has been run against a live
site yet.

## Credential

An **Atlassian account API token** plus that account's **email address**. Create
the token at https://id.atlassian.com/manage-profile/security/api-tokens (Atlassian
account → Security → API tokens → Create API token). toil sends
`Authorization: Basic base64(<email>:<apiToken>)`, as Atlassian documents for
scripts. There is no password, OAuth app or browser login. The token acts with the
account's own permissions, so a read sees what that account can see.

If the email and token don't match, Jira Cloud may treat the call as anonymous
rather than refuse it: a 401 is `AUTH`, but a missing issue can also surface as
`NOT_FOUND`, and a search as no results. When a call that should work finds nothing,
check `email` first.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_JIRA_CLOUD_BASE_URL` | yes | Jira Cloud site root, e.g. `https://imagile.atlassian.net` |
| `email` | `TOIL_JIRA_CLOUD_EMAIL` | yes | Email address of the Atlassian account the token belongs to |
| `apiToken` | `TOIL_JIRA_CLOUD_API_TOKEN` | yes | Atlassian account API token (a secret) |
| `project` | `TOIL_JIRA_CLOUD_PROJECT` | no | Default project for `create-issue` |
| `issueType` | `TOIL_JIRA_CLOUD_ISSUE_TYPE` | no | Default issue type for `create-issue` (`Task` when unset) |
| `priority` | `TOIL_JIRA_CLOUD_PRIORITY` | no | Default priority for `create-issue` |
| `writes` | `TOIL_JIRA_CLOUD_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

There is no CI fallback variable.

```bash
export TOIL_JIRA_CLOUD_BASE_URL=https://imagile.atlassian.net
export TOIL_JIRA_CLOUD_EMAIL=you@example.com
export TOIL_JIRA_CLOUD_API_TOKEN=<your API token>
```

Or `~/.toil/config.json`, with `project`, `issueType` and `priority` usually set once
under `defaults.jira-cloud`:

```json
{
  "version": 2,
  "connections": {
    "imagile-cloud": { "area": "jira-cloud", "baseUrl": "https://imagile.atlassian.net", "email": "you@example.com", "writes": true }
  },
  "defaults": { "jira-cloud": { "connection": "imagile-cloud", "project": "PROJ" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add imagile-cloud --area jira-cloud` (or
`toil connections login imagile-cloud`) to keep it in the OS credential store, or set
`TOIL_JIRA_CLOUD_API_TOKEN`. Env vars always win over the file.

## Commands

Every command also takes `--connection <name>`. Write commands (marked ✎) need
`writes: true` on the connection **and** `--allow-write`. Names and flags match
`jira` wherever the operation is the same. MCP tools are `jira_cloud_<command>`
(`jira_cloud_get_issue`).

| Command | Flags | Returns |
|---------|-------|---------|
| `get-issue` | `--key` | The issue as Jira returns it, plus `descriptionText` |
| `create-issue` ✎ | `--project --type --summary --description --priority --assignee <account-id> --labels --parent` | The created issue, read back, plus `descriptionText` |
| `update-issue` ✎ | `--key --summary --description --priority --assignee <account-id> --labels` | `{ updated }` |
| `transition-issue` ✎ | `--key --transition <name-or-id>` | `{ transitioned, transition }` |
| `list-transitions` | `--key` | Transitions available now |
| `add-comment` ✎ | `--key --body` | The comment, plus `bodyText` |
| `list-comments` | `--key` | Every comment, each with `bodyText` |
| `add-label` ✎ | `--key --labels` | `{ updated, labelsAdded }` |
| `remove-label` ✎ | `--key --labels` | `{ updated, labelsRemoved }` |
| `assign` ✎ | `--key --assignee <account-id>` | `{ assigned, assignee }` |
| `link-issue` ✎ | `--key --link-type --target` | `{ linked, to, type }` |
| `search` | `--jql` or `--jql-file`, `--max-results --cursor --fields` | `{ issues, maxResults, isLast }` |
| `list-projects` | `--query` | Every visible project |
| `get-project` | `--project` | The project |
| `search-users` | `--query --max-results` | Matching users, with `accountId` |
| `list-boards` | `--project` | Agile boards |
| `list-sprints` | `--board` or `--project`, `--state` | Sprints, each once |
| `set-sprint` ✎ | `--key --sprint` | `{ updated, sprint }` |

```bash
toil jira-cloud search --jql 'project = PROJ AND status = "In Progress"' --max-results 20
toil jira-cloud search-users --query smith
toil jira-cloud create-issue --project PROJ --type Bug --summary "Login broken" --description "Steps:\nOpen the page." --assignee 5b10ac8d82e05b22cc7d4ef5 --allow-write
toil jira-cloud list-sprints --project PROJ --state active
```

### People are accountIds

`--assignee` takes an **accountId** (`5b10ac8d82e05b22cc7d4ef5`), never a username or
email: Jira Cloud has no usernames in its API. Find one with `search-users --query
<name or email>`. People in output (`assignee`, `reporter`, `author`) carry
`accountId` and `displayName`; an email address appears only where the person's
profile settings allow it.

### Rich text (ADF)

A description and a comment body are ADF documents on Jira Cloud. toil converts them
simply, and no more:

- **In** (`--description`, `--body`): plain text. A blank line starts a new
  paragraph; a single line break becomes a hard break. Markdown, wiki markup and
  HTML are **not** interpreted: `**bold**` arrives as those characters.
- **Out**: Jira's ADF is returned untouched (`fields.description`, `body`), and a
  plain-text rendering sits beside it: `descriptionText` on an issue (`null` when
  it has no description) and `bodyText` on each comment. Formatting is dropped;
  text, mentions, emoji, links, dates, list items (`- `, `1. `) and table cells
  (`a | b`) keep their words.

### Search

`search` uses Jira Cloud's enhanced JQL search, which pages by token and reports
**no total**. Without `--max-results` it reads every match. With `--max-results N`
it returns at most N, `isLast` says whether that was all, and `meta.page.nextCursor`
resumes it: pass it back as `--cursor` with `--max-results`. `maxResults` in `data`
is how many issues came back. `--fields` takes field ids (`customfield_10016`);
the default is summary, status, priority, assignee, issuetype, project, created,
updated, labels and reporter. `--start-at` from `jira` doesn't exist here, since the
API has no offsets.

## Not in this area yet

Worklogs, attachments, custom fields by friendly name (`--field`, `--fields-file`,
`fields`), and `--input-file` / `schema`, which `jira` has, aren't built for Jira Cloud
yet. A custom field can still be read through `get-issue` or `search --fields`.

## Notes

- `create-issue` doesn't check for duplicates. After a timeout, search for the summary
  before retrying: the issue may already exist.
- `update-issue` with nothing to change is `INVALID_INPUT`; nothing is sent.
- `transition-issue` and `link-issue` treat an all-digits value as an id and anything
  else as a name (case-insensitive), looked up first.
- An issue key or id is sent as one URL path segment, encoded, so it can't change the
  endpoint called.
- A 429 is retried after the delay Jira asks for, as in every area.
