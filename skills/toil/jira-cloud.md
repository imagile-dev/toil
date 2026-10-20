---
area: jira-cloud
description: Issues, JQL search, transitions, comments, worklogs, labels, links, attachments, custom fields, projects, users, boards and sprints on Jira Cloud
---

# Jira Cloud (`jira-cloud`)

Issues, JQL search, transitions, comments, worklogs, labels, links, attachments,
custom fields, projects, users, boards and sprints on **Jira Cloud**
(`https://<your-site>.atlassian.net`, REST API 3 and the Agile REST API 1.0). Built
from Atlassian's API documentation and never run against a live site. Verification
level: `unit`.

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
| `baseUrl` | `TOIL_JIRA_CLOUD_BASE_URL` | yes | Jira Cloud site root, `https://<your-site>.atlassian.net` |
| `email` | `TOIL_JIRA_CLOUD_EMAIL` | yes | Email address of the Atlassian account the token belongs to |
| `apiToken` | `TOIL_JIRA_CLOUD_API_TOKEN` | yes | Atlassian account API token (a secret) |
| `customFields` | `TOIL_JIRA_CLOUD_CUSTOM_FIELDS` (JSON) | no | Custom fields addressable by friendly name; see **Custom fields** |
| `project` | `TOIL_JIRA_CLOUD_PROJECT` | no | Default project for `issue create` |
| `issueType` | `TOIL_JIRA_CLOUD_ISSUE_TYPE` | no | Default issue type for `issue create` (`Task` when unset) |
| `priority` | `TOIL_JIRA_CLOUD_PRIORITY` | no | Default priority for `issue create` |
| `writes` | `TOIL_JIRA_CLOUD_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

There is no CI fallback variable. The examples use the placeholder
`https://jira-cloud.imagile.dev`, which never resolves; your own site is
`https://<your-site>.atlassian.net`.

```bash
export TOIL_JIRA_CLOUD_BASE_URL=https://jira-cloud.imagile.dev
export TOIL_JIRA_CLOUD_EMAIL=you@example.com
export TOIL_JIRA_CLOUD_API_TOKEN=<your API token>
```

Or `~/.toil/config.json`, with `project`, `issueType` and `priority` usually set once
under `defaults.jira-cloud`:

```json
{
  "version": 2,
  "connections": {
    "imagile-cloud": { "area": "jira-cloud", "baseUrl": "https://jira-cloud.imagile.dev", "email": "you@example.com", "writes": true }
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
`jira` wherever the operation is the same. MCP tools are named after the path, with
spaces and hyphens as underscores (`jira_cloud_issue_get`, `jira_cloud_user_search`).

| Command | Arguments and flags | Returns |
|---------|-------|---------|
| `issue get` | `<key...>` (up to 100) | The issue as Jira returns it, registered custom fields under their friendly names, plus `descriptionText`. With several keys, `{ issues, errors }` |
| `issue history` | `<key> --limit --cursor` | The issue's change history, oldest first: `id`, `author`, `created`, `items` |
| `issue create` ✎ | `--project --type --summary --description --priority --assignee <account-id> --labels --parent --field (repeatable) --fields-file --input-file` | The created issue, read back, plus `descriptionText` |
| `issue update` ✎ | `<key> --summary --description --priority --assignee <account-id> --labels --field --fields-file --input-file` | `{ updated }` |
| `issue schema` | `--example-only` | `{ schema, example }` for `--input-file`, or just the example; needs no connection |
| `issue transition` ✎ | `<key> --transition <name-or-id>` or `--to <intent-or-status>` | `{ transitioned, transition }`; with `--to`, `meta.transition` says what it resolved to |
| `issue transitions` | `<key>` | Transitions available now |
| `issue comment` ✎ | `<key> --body` | The comment, plus `bodyText` |
| `issue comments` | `<key> --limit --cursor` | Every comment, or a page of them, each with `bodyText` |
| `issue log-work` ✎ | `<key> --time-spent --started --comment` | The worklog, plus `commentText` |
| `issue label` ✎ | `<key> --labels` | `{ updated, labelsAdded }` |
| `issue unlabel` ✎ | `<key> --labels` | `{ updated, labelsRemoved }` |
| `issue assign` ✎ | `<key> --assignee <account-id>` | `{ assigned, assignee }` |
| `issue link` ✎ | `<key> --target --type` | `{ linked, to, type }` |
| `issue search` | `--jql` or `--jql-file`, `--limit --cursor --updated-since --fields` | `{ issues, maxResults, isLast }` |
| `issue fields` | `--discover --custom-only --project --issue-type` | Registered custom fields, or Jira's field list with `suggestedType` (and `allowedValues` with `--project`) |
| `issue attach` ✎ | `<key> --file` | The attachments Jira created |
| `issue attachments` | `<key>` | The issue's attachments |
| `issue download` | `<key> <attachment-id> --dir` | `{ saved, filename, size }` |
| `issue set-sprint` ✎ | `<key> --sprint` | `{ updated, sprint }` |
| `project list` | `--query --limit --cursor` | Every visible project, or a page of them |
| `project get` | `<project>` | The project |
| `user search` | `--query --limit --cursor` | One page of matching users, with `accountId` |
| `board list` | `--project --limit --cursor` | Agile boards |
| `sprint list` | `--board` or `--project`, `--state`, `--limit --cursor` (with `--board`) | Sprints, each once |

```bash
toil jira-cloud issue search --jql 'project = PROJ AND status = "In Progress"' --limit 20
toil jira-cloud user search --query smith
toil jira-cloud issue create --project PROJ --type Bug --summary "Login broken" --description "Open the login page in Safari; the button does nothing." --assignee 5b10ac8d82e05b22cc7d4ef5 --allow-write
toil jira-cloud issue log-work PROJ-123 --time-spent "2h 30m" --started 2026-01-15T09:00:00.000+0000 --allow-write
toil jira-cloud issue link PROJ-123 --target PROJ-456 --type Blocks --allow-write
toil jira-cloud project get PROJ
toil jira-cloud sprint list --project PROJ --state active
```

### People are accountIds

`--assignee` takes an **accountId** (`5b10ac8d82e05b22cc7d4ef5`), never a username or
email: Jira Cloud has no usernames in its API. Find one with `user search --query
<name or email>`. People in output (`assignee`, `reporter`, `author`) carry
`accountId` and `displayName`; an email address appears only where the person's
profile settings allow it. A `user`-typed custom field sends `{ "accountId": ... }`.

### Rich text (ADF)

A description, a comment body and a worklog comment are ADF documents on Jira Cloud.
toil converts them simply, and no more:

- **In** (`--description`, `--body`, `--comment`): plain text. A blank line starts a
  new paragraph; a single line break becomes a hard break. Markdown, wiki markup and
  HTML are **not** interpreted: `**bold**` arrives as those characters. A line break
  has to be a real one: in bash, `$'one\ntwo'`; `\n` inside ordinary quotes is two
  characters.
- **In, from `--input-file`**: `fields.description` may also be an ADF document
  object (`{ "type": "doc", ... }`), sent as it is, for formatting plain text can't
  carry.
- **Out**: Jira's ADF is returned untouched (`fields.description`, `body`,
  `comment`), and a plain-text rendering sits beside it: `descriptionText` on an issue
  (`null` when it has no description), `bodyText` on each comment and `commentText` on
  a worklog. Formatting is dropped; text, mentions, emoji, links, dates, list items
  (`- `, `1. `) and table cells (`a | b`) keep their words.

### Search

`issue search` uses Jira Cloud's enhanced JQL search, which pages by token and reports
**no total**. Without `--limit` it reads every match. With `--limit N`
it returns at most N, `isLast` says whether that was all, and `meta.page.nextCursor`
resumes it: pass it back as `--cursor` with `--limit`. `maxResults` in `data`
is how many issues came back. `--fields` takes field ids or registered names; the
default is summary, status, priority, assignee, issuetype, project, created, updated,
labels, reporter and every registered custom field. `--start-at` from `jira` doesn't
exist here, since the API has no offsets.

### Paging, changes since, history and several issues

These are what a sync needs: read everything once, then only what changed.

```bash
toil jira-cloud issue search --jql 'project = ABC' --limit 100
toil jira-cloud issue search --jql 'project = ABC ORDER BY updated' --updated-since 2026-10-01T09:30:00Z
toil jira-cloud issue history ABC-123
toil jira-cloud issue get ABC-1 ABC-2 ABC-7
toil jira-cloud project list --limit 50
```

- **Paging.** Every list and search pages the same way. Without `--limit`,
  a list returns every item (`user search` excepted, below). With one, it returns that many and `meta.page.nextCursor` says where the next page
  starts; pass it back as `--cursor`, unchanged. `null` means that was the last page.
  `user search` is always one page; a full page hands out a cursor, which may lead
  to an empty one. `issue transitions`, `issue attachments` and `issue fields` have no
  paging, because Jira sends each of them whole. `sprint list` pages only with
  `--board`, since `--project` gathers sprints from several boards.
- **`--updated-since <iso>`** on `issue search` adds `updated >= "<instant>"` to the JQL,
  before any `ORDER BY`, with your JQL in parentheses. The instant is an ISO 8601
  date (`2026-10-01`, read as midnight UTC) or a date and time with a zone
  (`2026-10-01T09:30:00Z`). JQL has no time zones, so toil reads your account's zone
  from `/rest/api/3/myself` and writes the instant in it, rounded down to the minute;
  an issue near the boundary can come back twice, never not at all. If Jira names no
  zone it knows, toil writes UTC and warns with `JIRA_CLOUD_TIME_ZONE`. On its own,
  `--updated-since` is the whole query.
- **`issue history`** reads `/rest/api/3/issue/{key}/changelog`, oldest first, each
  entry with `id`, `author` (an `accountId`), `created` and `items` (`field`,
  `fieldtype`, `fieldId`, `from`, `fromString`, `to`, `toString`).
- **Several issues.** Give `issue get` several keys (up to 100) and it reads them in one
  `POST /rest/api/3/issue/bulkfetch` and returns `{ issues, errors }`: the issues in
  the order you asked, and each key that couldn't be read as `{ key, code, message }`,
  with a `JIRA_CLOUD_BULK_PARTIAL` warning, and never more than one error per key.
  Jira leaves out a key it can't find or won't show, returns a moved issue under its
  new key, and names an issue it couldn't fetch only by id. A key asked for by id
  that Jira couldn't fetch is `HTTP` with Jira's message. A key with no answer is
  `NOT_FOUND` when everything else Jira sent is accounted for; otherwise it's
  `UNMATCHED`, with a message naming the issues returned under other keys and the
  ids Jira couldn't fetch, since the answer doesn't say which is which. Issues
  returned under another key still come back, after the others. One key returns
  the issue itself. Over MCP, `key` takes a string or a list.

## Large fields via --input-file

`issue create` and `issue update` take `--input-file <path>` (`-` reads stdin on the
CLI) describing the issue as `{ project, issueType, fields: { ... } }`.
`toil jira-cloud issue schema` returns its JSON Schema and an example. Any string value in
`fields` may be `@path/to/file` to read it from a file. Flags override matching keys
from the file, and each override is reported in `meta.warnings` as
`JIRA_CLOUD_INPUT_OVERRIDDEN`. The project comes from `--project`, then the file, then
the connection's `project`; `meta.context` says which.

```bash
toil jira-cloud issue schema --example-only > envelope.json   # the example is in .data
toil jira-cloud issue create --input-file issue.json --priority Low --allow-write
```

Over MCP, `-` is refused because stdin carries the protocol; pass a file path.

## Custom fields

`--field Name=value` (repeatable), `--fields-file` and `--input-file` accept a raw field
id (`customfield_10016`) or a standard field name (`fixVersions`) with no setup, and
send the value as given. `Name=@file.json` reads the value from a file: JSON when it
parses, text otherwise.

To use a **friendly name** in flags, JQL and output, register the field on the
connection:

```json
"customFields": [{ "id": "customfield_10016", "name": "Story Points", "type": "number" }]
```

`type` shapes a `--field` value: `string`, `number`, `date`, `datetime`, `select`
(`{value}`), `multi-select`, `option-id` (`{id}`), `cascading-select` (`parentId` or
`parentId:childId`), `user` (`{accountId}`), `multi-user` (comma-separated accountIds, `[{accountId}]`), `labels`, `url`, and `textarea`, which
is plain text sent as ADF, since a multi-line text field takes ADF on Cloud. Omit it to
send the raw string. A value in `--fields-file` or `--input-file` is sent untouched, so
a multi-line text field there needs ADF. `issue fields --discover` lists Jira's fields with a
`suggestedType` (a single-line text field is `string`, a multi-line one `textarea`); add
`--project PROJ` for each select field's `allowedValues`, from the paged createmeta
endpoints. **Sprint is not a custom field**: use `issue set-sprint` after the issue exists.

## Attachments

`issue attach` uploads one file as multipart with `X-Atlassian-Token: no-check`.
`issue download` looks the id up on the issue, then asks Jira for the bytes with
`GET /rest/api/3/attachment/content/<id>?redirect=false`, so the request never leaves
your site and the credential goes nowhere else. It saves under `.toil/` (or `--dir`),
keeping only the file name, and never replaces a file that's already there. A name
Windows would read as another file is saved as one it won't: a device name such as
`CON` gets a leading `_`, a `:` and what follows it is dropped, as are trailing dots
and spaces.

## Ticket the work

Before starting work no ticket covers, rank your open issues against it:

```bash
toil jira-cloud issue search --jql "assignee = currentUser() AND statusCategory != Done" --fields summary,description,status,issuetype,labels,parent | toil util owi map | toil util owi similar --query "Card payments time out at checkout"
```

Then ask the person, as `core.md`, **Ticket the work**, says: attach the work to a
match (nothing is written), create a sub-task under it, or create a new ticket. A
sub-task is
`toil jira-cloud issue create --type Subtask --parent PAY-12 --summary "<text>" --allow-write`
(the project may name the type differently); a new ticket takes the project and type
from the dossier and the connection. Both are writes, made only on the person's yes.

## Notes

- `issue create` doesn't check for duplicates. After a timeout, search for the summary
  before retrying: the issue may already exist.
- `issue update` with nothing to change is `INVALID_INPUT`; nothing is sent.
- `issue log-work` needs `--started`: Jira Cloud's API requires it, where `jira` lets the
  server default it.
- `sprint list --project` reads scrum and team-managed (`simple`) boards and skips
  kanban ones. A team-managed board whose project hasn't turned sprints on answers 400;
  it's skipped with a `JIRA_CLOUD_NO_SPRINTS` warning naming it. Any other failure is
  the command's error.
- `issue transition` and `issue link` treat an all-digits value as an id and anything
  else as a name (case-insensitive), looked up first.
- An issue key or id is sent as one URL path segment, encoded, so it can't change the
  endpoint called. A project key from `--project`, the connection's `project` setting
  or a dossier that holds `/`, `\`, `?`, `#`, `%` or a control character is refused
  with `INVALID_INPUT`.
- A 429 is retried after the delay Jira asks for, as in every area.

## Checking a dossier

`check-dossier` checks the call's dossier: each project key it names (`project`, `projects`) exists, and each field alias in `fields` names a field id the site has. It's `toil jira-cloud check-dossier` (`--dossier <name|file>`, or the dossier the folder resolves to), and it returns `{ dossier, connection, env, ok, checked, checks, unchecked }`, one check per value with its key path. The CLI exits 1 when one is missing. A failure other than not-found (a bad token, an unreachable host) fails the command. Read only.
