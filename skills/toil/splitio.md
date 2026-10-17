---
area: splitio
description: Split.IO feature flags, environments and change requests through the Split Admin API
---

# Split.IO (`splitio`)

Feature flags, environments and change requests on **Split.IO** (Harness FME),
through the Admin API under `/internal/api/v2`. The reads list workspaces,
environments, flags and change requests; every write files a **change request**
that Split's approvers then accept or reject. toil never changes a flag directly.
Verification level: `unit`.

**Supported versions:** The oldest Split.IO Admin API version toil supports hasn't been established. toil calls the
Admin API under `/internal/api/v2` with an Admin API key sent as a Bearer header. It
has not been run against a live Split account yet.

## Credential

A Split **Admin API key**: in Split, Admin settings → API keys → Create API key, with
the type Admin. toil sends it as `Authorization: Bearer <key>`. There is no login and
no token exchange.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_SPLITIO_BASE_URL` | yes | Admin API root, normally `https://api.split.io` |
| `adminApiKey` | `TOIL_SPLITIO_ADMIN_API_KEY` | yes | Admin API key |
| `workspace` | `TOIL_SPLITIO_WORKSPACE` | no | Default Split workspace (project) ID, used when `--ws` is not given |

There is no CI fallback variable.

```bash
export TOIL_SPLITIO_BASE_URL=https://api.split.io
export TOIL_SPLITIO_ADMIN_API_KEY=<your Admin API key>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "split": { "area": "splitio", "baseUrl": "https://api.split.io", "workspace": "<workspace id>" }
  }
}
```

The key never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add split --area splitio` to keep it in the
OS credential store, or set `TOIL_SPLITIO_ADMIN_API_KEY`.

## The workspace is `--ws`

Every command but `workspaces list` and `change-requests get` acts in one Split
workspace: `--ws <id>`, else the connection's `workspace`. Over MCP the field is
`workspace`. **On the CLI, `--workspace` is toil's own flag** for the folder commands
may read files in, so `--workspace <split id>` doesn't name the Split workspace; a
command left without one fails with `INVALID_INPUT` saying to pass `--ws`.

## Commands

Reads:

- `workspaces list`: List all Split.IO workspaces, every page.
- `environments list`: List environments in a workspace.
- `flags list`: List feature flags in a workspace. `--limit` (default 50, Split's
  maximum) and `--offset` (default 0); `data.totalCount` is Split's total.
  `--flag-set` is sent as `flagSetName`, which Split's reference doesn't document,
  so the result carries a warning to compare `totalCount` with an unfiltered list.
- `flags get`: Get a flag (`--flag`), or with `--environment` its definition in that
  environment: treatments, rules, default rule, kill state.
- `change-requests list`: List Change Requests for a workspace (`--environment`,
  `--status`; Split returns `REQUESTED` ones when `--status` is unset). `--limit`
  defaults to 25 (Split allows 1 to 100). Split pages by marker: pass
  `data.nextMarker` (also `meta.page.nextCursor`) as `--after` for the next page.
  `--offset` accepts only 0, and `totalCount` is `null`, since Split reports none.
- `change-requests get`: Get a Change Request by ID (`--id`).

Writes, each a change request against one `--environment`. They need `writes: true`
on the connection and `--allow-write` on the call. Every one takes `--mnemonic` (the
title), `--description` (the comment), `--change-number` (added to the comment as
"Change number: …", since Split has no field for it), `--approvers` (comma-separated
email addresses, only where the environment lets submitters choose) and
`--rollout-status <id>` (a rollout status ID; Split's guide says KILL doesn't need
one, and the others may).

- `flags update`: Replace a flag's definition with the JSON object in `--input-file`
  (`-` reads stdin on the CLI). Start from `flags get --environment`.
- `flags set-rule`: Change rule `--rule-index` (from 0) to one `--treatment` (a
  100% bucket) or `--weights` (a JSON array of `{treatment, size}`, sizes in percent).
  The rest of the definition is copied from the current one.
- `flags set-default`: Set the default rule to one `--treatment` at 100%.
- `flags toggle`: `--enabled false` (or `0`) kills the flag; **any other value
  restores it**, `off` and `no` included.
- `flags batch-toggle`: One change request per entry of `--input-file`, a JSON array
  of `{flag, enabled}`, titled `<mnemonic> — <flag>`. A failed entry doesn't stop the
  rest; it's reported in `results[]` with `ok: false`, the envelope stays `ok`, and
  `meta.warnings` says how many failed. `enabled` is read by truthiness, so the
  string `"false"` restores.
- `flags kill`, `flags restore`: Kill or restore a flag in the environment.
- `flags archive`: Remove a flag's definition from the environment (Split's
  `ARCHIVE` change request; not Split's flag-archive API).

```bash
toil splitio workspaces list
toil splitio flags get --ws <workspace id> --flag new_checkout --environment <environment id>
toil splitio flags kill --ws <workspace id> --flag new_checkout --environment <environment id> \
  --mnemonic checkout-off --description "Kill during incident" --change-number CHG0001234 --allow-write
```
