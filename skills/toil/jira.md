---
area: jira
description: Issues, JQL search, transitions, comments, worklogs, labels, links, attachments, custom fields, boards and sprints on Jira Data Center
---

# Jira Data Center (`jira`)

Issues, JQL search, transitions, comments, worklogs, labels, links, attachments,
custom fields, boards and sprints on **Jira Data Center / Server** (`/rest/api/2`
and `/rest/agile/1.0`). Verification level: `unit`.

**Supported versions:** Jira Data Center 8.14 or later (REST API 2 and Agile REST API 1.0). toil
authenticates with a personal access token, which Jira Data Center added in 8.14. No
release has been verified yet.

## Credential

A Jira **personal access token**: in Jira, your profile picture → Profile →
Personal Access Tokens → Create token. toil sends it as `Authorization: Bearer <token>`.
There is no username, password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_JIRA_BASE_URL` | yes | Jira server root, e.g. `https://jira.imagile.dev` (keep any context path, e.g. `https://jira.imagile.dev/jira`) |
| `apiToken` | `TOIL_JIRA_API_TOKEN` | yes | Personal access token |
| `customFields` | `TOIL_JIRA_CUSTOM_FIELDS` (JSON) | no | Custom fields addressable by friendly name; see **Custom fields** |
| `project` | `TOIL_JIRA_PROJECT` | no | Default project for `issue create` |
| `issueType` | `TOIL_JIRA_ISSUE_TYPE` | no | Default issue type for `issue create` (`Task` when unset) |
| `priority` | `TOIL_JIRA_PRIORITY` | no | Default priority for `issue create` |
| `writes` | `TOIL_JIRA_WRITES` | no | `true` lets write commands run (with `--allow-write`) |

Environment variables (CI, or a one-off shell):

```bash
export TOIL_JIRA_BASE_URL=https://jira.imagile.dev
export TOIL_JIRA_API_TOKEN=<your personal access token>
```

Or `~/.toil/config.json`, with `project`, `issueType` and `priority` usually set once
under `defaults.jira` so every Jira connection shares them:

```json
{
  "version": 2,
  "connections": {
    "corp-jira": { "area": "jira", "baseUrl": "https://jira.imagile.dev", "writes": true }
  },
  "defaults": { "jira": { "connection": "corp-jira", "project": "ABC", "issueType": "Story" } }
}
```

The token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-jira --area jira` (or
`toil connections login corp-jira` for an existing connection) to keep it in the OS
credential store, which writes `"apiToken": "keychain:…"`, or set
`TOIL_JIRA_API_TOKEN`.

Env vars always win over the file. A second Jira server is a second connection
(`"lab-jira": { "area": "jira", ... }`), chosen per call with `--connection lab-jira`
or configured from env with `TOIL_CONN_LAB_JIRA_AREA=jira` plus
`TOIL_CONN_LAB_JIRA_BASE_URL` and `TOIL_CONN_LAB_JIRA_API_TOKEN`.

## Commands

Every command also takes `--connection <name>`. Write commands (marked ✎) need
`writes: true` on the connection **and** `--allow-write`; over MCP they are only
listed when writes are on, and `allowWrite: true` stands in for the flag.

| Command | Arguments and flags | Returns |
|---------|-------|---------|
| `issue get` | `<key...>` (up to 100) | The issue; registered custom fields under their friendly names. With several keys, `{ issues, errors }` |
| `issue history` | `<key> --limit --cursor` | The issue's change history: `id`, `author`, `created`, `items` |
| `issue create` ✎ | `--project --type --summary --description --priority --assignee --labels --parent --field (repeatable) --fields-file --input-file` | The created issue, read back |
| `issue update` ✎ | `<key> --summary --description --priority --assignee --labels --field --fields-file --input-file` | `{ updated }` |
| `issue schema` | `--example-only` | `{ schema, example }` for `--input-file`, or just the example |
| `issue transition` ✎ | `<key> --transition <name-or-id>` | `{ transitioned, transition }` |
| `issue transitions` | `<key>` | Transitions available now |
| `issue comment` ✎ | `<key> --body` | The comment |
| `issue comments` | `<key> --limit --cursor` | Every comment, or a page of them |
| `issue log-work` ✎ | `<key> --time-spent --comment --started` | The worklog |
| `issue search` | `--jql` or `--jql-file`, `--limit --start-at --cursor --updated-since --fields` | `{ issues, total, startAt, maxResults }` |
| `issue label` ✎ / `issue unlabel` ✎ | `<key> --labels a,b` | `{ updated, labelsAdded }` / `{ updated, labelsRemoved }` |
| `issue assign` ✎ | `<key> --assignee <username>` | `{ assigned, assignee }` |
| `issue link` ✎ | `<key> --target --type` | `{ linked, to, type }` |
| `issue attach` ✎ | `<key> --file` | The attachments created |
| `issue attachments` | `<key>` | Attachments (id, filename, size, mimeType, content) |
| `issue download` | `<key> <attachment-id> --dir` | `{ saved, filename, size }`; saves to `.toil/` by default |
| `issue fields` | `--discover --custom-only --project --issue-type` | Registered fields, or Jira's field list with `suggestedType` and `allowedValues` |
| `issue set-sprint` ✎ | `<key> --sprint <id>` | `{ updated, sprint }` |
| `board list` | `--project --limit --cursor` | Boards (id, name, scrum or kanban) |
| `sprint list` | `--board` or `--project`, `--state active,future,closed`, `--limit --cursor` (with `--board`) | Sprints with dates and goal |
| `api` | `<method> <path> --query key=value (repeatable) --body-file --content-type` | The response body; see **Any endpoint** below. ✎ for `POST`, `PUT`, `PATCH`, `DELETE` |
| `check-dossier` | `--dossier <name\|file>` (or the folder's dossier) | `{ dossier, connection, env, ok, checked, checks, unchecked }`: each project and field id the dossier names, found or not; exit 1 when one is missing |

Over MCP the same commands are tools named after the path, with spaces and
hyphens as underscores (`jira_issue_get`, `jira_sprint_list`,
`jira_issue_log_work`), taking camelCase fields named after the arguments and
flags (`key`, `issueType`, `limit`, `attachmentId`).

## Examples

```bash
toil jira issue get ABC-123
toil jira issue search --jql 'project = ABC AND status = "In Progress"' --limit 20
toil jira issue search --jql-file query.jql --fields summary,status,"Story Points"
toil jira issue create --project ABC --type Bug --summary "Login broken on Safari" --priority High --allow-write
toil jira issue transition ABC-123 --transition "In Progress" --allow-write
toil jira issue comment ABC-123 --body "Reproduced on staging." --allow-write
toil jira issue log-work ABC-123 --time-spent "2h 30m" --comment "Investigated the failing build" --allow-write
toil jira issue link ABC-123 --target ABC-456 --type Blocks --allow-write
toil jira sprint list --project ABC --state active,future
toil jira issue set-sprint ABC-123 --sprint 42 --allow-write
toil jira issue download ABC-123 10001 --dir downloads
```

`issue search` without `--limit` pages through every match, so bound broad
queries. `meta.page.nextCursor` is the `--start-at` for the next page (or `null`).

## Paging, changes since, history and several issues

These are what a sync needs: read everything once, then only what changed.

```bash
toil jira issue search --jql 'project = ABC' --limit 100
toil jira issue search --jql 'project = ABC' --limit 100 --cursor 100
toil jira issue search --jql 'project = ABC ORDER BY updated' --updated-since 2026-10-01T09:30:00Z
toil jira issue history ABC-123
toil jira issue get ABC-1 ABC-2 ABC-7
toil jira issue comments ABC-123 --limit 50
```

- **Paging.** Every list and search pages the same way. Without `--limit`, it
  returns every item. With one, it returns that many and `meta.page.nextCursor`
  says where the next page starts; pass it back as `--cursor`, unchanged. `null`
  means that was the last page. `issue transitions`, `issue attachments` and
  `issue fields` have no paging, because Jira sends each of them whole.
  `sprint list` pages only with `--board`, since `--project` gathers sprints
  from several boards.
- **`--updated-since <iso>`** on `issue search` adds `updated >= "<instant>"` to the JQL,
  before any `ORDER BY`, with your JQL in parentheses. The instant is an ISO 8601
  date (`2026-10-01`, read as midnight UTC) or a date and time with a zone
  (`2026-10-01T09:30:00Z`). JQL has no time zones, so toil reads your profile's
  zone from `/rest/api/2/myself` and writes the instant in it, rounded down to the
  minute; an issue near the boundary can come back twice, never not at all. If Jira
  names no zone it knows, toil writes UTC and warns with `JIRA_TIME_ZONE`. On its
  own, `--updated-since` is the whole query.
- **`issue history`** returns the history entries Jira records for an issue, each
  with `id`, `author`, `created` and `items` (`field`, `fieldtype`, `from`,
  `fromString`, `to`, `toString`). Data Center sends the history with the issue
  (`expand=changelog`), all at once, and `--limit` / `--cursor` page it. If Jira
  reports more entries than it sent, a `JIRA_CHANGELOG_TRUNCATED` warning says so.
- **Several issues.** Give `issue get` several keys (up to 100) and it returns
  `{ issues, errors }`: the issues in the order you asked, and each key that couldn't
  be read as `{ key, code, message }` (`NOT_FOUND`, or `HTTP` for another refusal),
  with a `JIRA_BULK_PARTIAL` warning. A rejected token or a network failure fails the
  whole call. Data Center has no bulk endpoint, so toil sends one request per key,
  five at a time. One key returns the issue itself. Over MCP, `key`
  takes a string or a list.
`issue create` takes its project from `--project`, then `project` in `--input-file`, then
the connection's `project`, and `meta.context.inputs.project` says which: `input` for
the flag or the file, `connection` for the setting (`TOIL_JIRA_PROJECT` and
`defaults.jira.project` both report `connection`, not `default`). The `--project` on `issue fields`,
`board list` and `sprint list` never falls back to the connection.
`--time-spent` takes Jira durations (`1d`, `2h 30m`); `--started` takes Jira's datetime
format (`2024-01-15T09:00:00.000+0000`) and defaults to now.

## Any endpoint: `jira api`

When no command above covers an endpoint, `jira api` calls it directly. It sends
the connection's own credential, the same way every other `jira` command does,
to a path under the connection's `baseUrl`:

```bash
toil jira api GET /rest/api/2/myself
toil jira api GET /rest/api/2/issue/ABC-123/remotelink
toil jira api GET /rest/agile/1.0/board/12/backlog --query fields=summary --query maxResults=20
toil jira api POST /rest/api/2/version --body-file version.json --allow-write
toil jira api PUT /rest/api/2/issue/ABC-123/watchers --body-file user.json --content-type application/json --allow-write
```

- **The path** is relative to `baseUrl` (a context path such as `/jira` is kept),
  with or without a leading `/` (in Git Bash on Windows, leave it off: the shell
  rewrites `/rest/...` into a file path, which is refused). A full URL, a scheme, `//host`, a leading
  backslash or a `.` / `..` segment is refused with `INVALID_INPUT` before anything
  is sent, so the token never leaves the connection's host.
- **The method decides the gate.** `GET` and `HEAD` are reads. `POST`, `PUT`,
  `PATCH` and `DELETE` are writes: they need `writes: true` on the connection
  **and** `--allow-write`. `DELETE` works only on the CLI: over MCP, `jira_api`
  refuses it with `INVALID_INPUT`.
- **`--query key=value`** adds a query parameter; repeat it for more, or to repeat
  a key. **`--body-file <path>`** sends that file (inside the workspace, or `-` for
  stdin) as the body, as `application/json` unless `--content-type` says
  otherwise.
- **Output:** a JSON body is `data`, parsed. A text body (`text/*`, XML, or no content
  type) is `data` as text. Any other body is binary: `data` is its bytes as base64,
  with an `API_BINARY` warning (use `issue download` to save an attachment).
  Text and binary are capped at 1 MB, with an `API_TRUNCATED` warning when the body
  was longer. An empty body (a `204`,
  a `HEAD`) is `null`. `meta.response` is `{ status, contentType }`. Errors use the
  usual codes (`AUTH`, `NOT_FOUND`, `HTTP`, `NETWORK`) with Jira's own message. A
  body labelled JSON that doesn't parse comes back as text, with an `API_NOT_JSON`
  warning.
- **Over MCP** it's the `jira_api` tool, with `method`, `path`, `query` (an array of
  `key=value` strings), `bodyFile`, `contentType` and `allowWrite`.

Prefer a wrapped command when one exists: it knows the endpoint's paging, custom
fields and quirks, and `jira api` doesn't.

## Large fields via --input-file

`issue create` and `issue update` take `--input-file <path>` (`-` reads stdin on the
CLI) describing the issue as `{ project, issueType, fields: { ... } }`.
`toil jira issue schema` returns its JSON Schema and an example. Any string value in `fields`
may be `@path/to/file` to read it from a file. Flags override matching keys from the file,
and each override is reported in `meta.warnings`.

```bash
toil jira issue schema --example-only > envelope.json   # the example is in .data
toil jira issue create --input-file issue.json --priority Low --allow-write
```

Over MCP, `-` is refused because stdin carries the protocol; pass a file path.
Relative paths resolve against the directory toil runs in.

## Custom fields

`--field Name=value` (repeatable), `--fields-file` and `--input-file` accept a raw field
id (`customfield_10032`) or a standard field name (`fixVersions`) with no setup.
`Name=@file.json` reads the value from a file: JSON when it parses, text otherwise, which
also avoids shell quoting trouble in PowerShell.

To use a **friendly name** in flags, JQL and output, register the field on the
connection:

```json
"customFields": [{ "id": "customfield_10016", "name": "Story Points", "type": "number" }]
```

`type` shapes a `--field` value: `string`, `number`, `date`, `datetime`, `select`
(`{value}`), `multi-select`, `option-id` (`{id}`), `cascading-select` (`parent` or
`parent:child` ids), `user` (`{name}`), `labels`, `url`, `textarea`. Omit it to send the
raw string. `toil jira issue fields --discover` lists Jira's fields with a `suggestedType`; add
`--project ABC` to see each select field's `allowedValues`. A select field that only
accepts option ids needs `"type": "option-id"`. **Sprint is not a custom field**: use
`issue set-sprint` after the issue exists.

A **dossier** can name fields too (`"jira": { "fields": { "storyPoints": "customfield_10016" } }`,
or `toil dossiers field <dossier> jira storyPoints customfield_10016`). Then
`issue create` and `issue update` take `--field storyPoints=5` in any folder the dossier
applies to. An alias takes the type the connection registers for that id. A name the
connection already uses keeps the connection's meaning.

## Data Center, not Cloud

This area targets Jira Data Center and Server. Users are **usernames** (`--assignee
jsmith`, `user`-typed fields send `{ "name": ... }`), where Jira Cloud needs an
`accountId`. Jira Cloud is a separate area, `jira-cloud`, with its own
`TOIL_JIRA_CLOUD_*` settings; don't point this one at a Cloud site.

## Notes

- `issue create` doesn't check for duplicates. After a timeout, search for the summary
  before retrying: the issue may already exist.
- `issue update` with nothing to change still sends an empty update and reports
  `{ updated }`.
- `issue download` never replaces a file. If one of the same name is already in the target directory, it fails with `INVALID_INPUT`; delete the file or pass a different `--dir`.
- `issue download` only ever sends the token to `baseUrl`'s host. If Jira names
  another host for the file, toil fetches the same path from `baseUrl` and warns.
