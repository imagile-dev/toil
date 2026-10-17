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
| `project` | `TOIL_JIRA_PROJECT` | no | Default project for `create-issue` |
| `issueType` | `TOIL_JIRA_ISSUE_TYPE` | no | Default issue type for `create-issue` (`Task` when unset) |
| `priority` | `TOIL_JIRA_PRIORITY` | no | Default priority for `create-issue` |
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

| Command | Flags | Returns |
|---------|-------|---------|
| `get-issue` | `--key` | The issue; registered custom fields under their friendly names |
| `create-issue` ✎ | `--project --type --summary --description --priority --assignee --labels --parent --field (repeatable) --fields-file --input-file` | The created issue, read back |
| `update-issue` ✎ | `--key --summary --description --priority --assignee --labels --field --fields-file --input-file` | `{ updated }` |
| `schema` | `--example-only` | `{ schema, example }` for `--input-file`, or just the example |
| `transition-issue` ✎ | `--key --transition <name-or-id>` | `{ transitioned, transition }` |
| `list-transitions` | `--key` | Transitions available now |
| `add-comment` ✎ | `--key --body` | The comment |
| `list-comments` | `--key` | Every comment |
| `log-work` ✎ | `--key --time-spent --comment --started` | The worklog |
| `search` | `--jql` or `--jql-file`, `--max-results --start-at --fields` | `{ issues, total, startAt, maxResults }` |
| `add-label` ✎ / `remove-label` ✎ | `--key --labels a,b` | `{ updated, labelsAdded }` / `{ updated, labelsRemoved }` |
| `assign` ✎ | `--key --assignee <username>` | `{ assigned, assignee }` |
| `link-issue` ✎ | `--key --link-type --target` | `{ linked, to, type }` |
| `add-attachment` ✎ | `--key --file` | The attachments created |
| `list-attachments` | `--key` | Attachments (id, filename, size, mimeType, content) |
| `download-attachment` | `--key --attachment-id --dir` | `{ saved, filename, size }`; saves to `.toil/` by default |
| `fields` | `--discover --custom-only --project --issue-type` | Registered fields, or Jira's field list with `suggestedType` and `allowedValues` |
| `list-boards` | `--project` | Boards (id, name, scrum or kanban) |
| `list-sprints` | `--board` or `--project`, `--state active,future,closed` | Sprints with dates and goal |
| `set-sprint` ✎ | `--key --sprint <id>` | `{ updated, sprint }` |

Over MCP the same commands are tools named `jira_<command>` with hyphens as
underscores (`jira_get_issue`, `jira_list_sprints`), taking camelCase fields
(`key`, `issueType`, `maxResults`, `attachmentId`).

## Examples

```bash
toil jira get-issue --key ABC-123
toil jira search --jql 'project = ABC AND status = "In Progress"' --max-results 20
toil jira search --jql-file query.jql --fields summary,status,"Story Points"
toil jira create-issue --project ABC --type Bug --summary "Login broken on Safari" --priority High --allow-write
toil jira transition-issue --key ABC-123 --transition "In Progress" --allow-write
toil jira add-comment --key ABC-123 --body "Reproduced on staging." --allow-write
toil jira log-work --key ABC-123 --time-spent "2h 30m" --comment "Investigated the failing build" --allow-write
toil jira list-sprints --project ABC --state active,future
toil jira set-sprint --key ABC-123 --sprint 42 --allow-write
toil jira download-attachment --key ABC-123 --attachment-id 10001 --dir downloads
```

`search` without `--max-results` pages through every match, so bound broad
queries. `meta.page.nextCursor` is the `--start-at` for the next page (or `null`).
`create-issue` takes its project from `--project`, then `project` in `--input-file`, then
the connection's `project`, and `meta.context.inputs.project` says which: `input` for
the flag or the file, `connection` for the setting (`TOIL_JIRA_PROJECT` and
`defaults.jira.project` both report `connection`, not `default`). The `--project` on `fields`,
`list-boards` and `list-sprints` never falls back to the connection.
`--time-spent` takes Jira durations (`1d`, `2h 30m`); `--started` takes Jira's datetime
format (`2024-01-15T09:00:00.000+0000`) and defaults to now.

## Large fields via --input-file

`create-issue` and `update-issue` take `--input-file <path>` (`-` reads stdin on the
CLI) describing the issue as `{ project, issueType, fields: { ... } }`.
`toil jira schema` returns its JSON Schema and an example. Any string value in `fields`
may be `@path/to/file` to read it from a file. Flags override matching keys from the file,
and each override is reported in `meta.warnings`.

```bash
toil jira schema --example-only > envelope.json   # the example is in .data
toil jira create-issue --input-file issue.json --priority Low --allow-write
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
raw string. `toil jira fields --discover` lists Jira's fields with a `suggestedType`; add
`--project ABC` to see each select field's `allowedValues`. A select field that only
accepts option ids needs `"type": "option-id"`. **Sprint is not a custom field**: use
`set-sprint` after the issue exists.

## Data Center, not Cloud

This area targets Jira Data Center and Server. Users are **usernames** (`--assignee
jsmith`, `user`-typed fields send `{ "name": ... }`), where Jira Cloud needs an
`accountId`. Jira Cloud is a separate area, `jira-cloud`, with its own
`TOIL_JIRA_CLOUD_*` settings; don't point this one at a Cloud site.

## Notes

- `create-issue` doesn't check for duplicates. After a timeout, search for the summary
  before retrying: the issue may already exist.
- `update-issue` with nothing to change still sends an empty update and reports
  `{ updated }`.
- `download-attachment` never replaces a file. If one of the same name is already in the target directory, it fails with `INVALID_INPUT`; delete the file or pass a different `--dir`.
- `download-attachment` only ever sends the token to `baseUrl`'s host. If Jira names
  another host for the file, toil fetches the same path from `baseUrl` and warns.
