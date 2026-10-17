---
area: contrast
description: Applications, vulnerability findings and libraries for a Contrast Security organization
---

# Contrast Security (`contrast`)

Applications, vulnerability findings (traces) and libraries for one **Contrast
Security** organization, through the TeamServer "ng" REST API
(`/Contrast/api/ng/<orgUuid>/...`), on SaaS or self-hosted. Every command reads; none
changes anything. Verification level: `unit`.

**Supported versions:** The oldest Contrast TeamServer version toil supports hasn't been established. toil calls the TeamServer "ng" REST API with an API key and a
service key. No release has been verified yet.

## Credential

Three values, all from **User Settings → Your Keys** in Contrast: your username, the
organization's **API key** and your **service key**, plus the organization UUID shown
on the same page. toil sends two headers on every request:

- `Authorization: base64(username:serviceKey)`, with no `Basic ` prefix, which is
  Contrast's own format
- `API-Key: <apiKey>`

There is no password or browser login. A redirect to another host is refused, so the
API key never leaves the configured instance.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_CONTRAST_BASE_URL` | yes | Instance root, e.g. `https://contrast.imagile.dev` or `https://app.contrastsecurity.com` |
| `orgUuid` | `TOIL_CONTRAST_ORG_UUID` | yes | Organization UUID |
| `username` | `TOIL_CONTRAST_USERNAME` | yes | Contrast username |
| `apiKey` | `TOIL_CONTRAST_API_KEY` | yes | Organization API key (secret) |
| `serviceKey` | `TOIL_CONTRAST_SERVICE_KEY` | yes | Your service key (secret) |

There's no CI fallback variable.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_CONTRAST_BASE_URL=https://contrast.imagile.dev
export TOIL_CONTRAST_ORG_UUID=abc12345-0000-0000-0000-000000000000
export TOIL_CONTRAST_USERNAME=you@example.com
export TOIL_CONTRAST_API_KEY=<your API key>
export TOIL_CONTRAST_SERVICE_KEY=<your service key>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "corp-contrast": {
      "area": "contrast",
      "baseUrl": "https://contrast.imagile.dev",
      "orgUuid": "abc12345-0000-0000-0000-000000000000",
      "username": "you@example.com"
    }
  },
  "defaults": { "contrast": { "connection": "corp-contrast" } }
}
```

`apiKey` and `serviceKey` never go in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add corp-contrast --area contrast` (or
`toil connections login corp-contrast` for an existing connection) to keep them in the
OS credential store, or set the env vars.

## Commands

`data` is Contrast's own response, as it came, except for `libraries get`.

- `apps list`: List applications in the organization.
- `findings list`: List vulnerability findings for an application (`--app`, required).
  `--severity` and `--status` are sent as `severities` and `statuses`, as typed; a
  comma list such as `HIGH,CRITICAL` keeps its commas.
- `findings get`: Get details for a specific vulnerability finding (`--app` and
  `--trace`, both required).
- `libraries list`: List libraries used by an application, as shown on the Libraries
  tab (`--app`, required).
- `libraries get`: Get details for a specific library used by an application, by hash
  (`--app` and `--hash`, both required). It reads the application's libraries 25 at a
  time until one's `hash` matches exactly, or a page has fewer than 25, and returns
  that one library object. No match is `NOT_FOUND`. It stops with an error after
  1,000 pages.

`apps list`, `findings list` and `libraries list` take `--limit` (default 25) and
`--offset` (default 0), sent to the server as given; they return one page, and you
page by hand. `--app`, `--trace` and the org UUID go into the URL path as typed.

```bash
toil contrast apps list --limit 50
toil contrast findings list --app abc12345-0000-0000-0000-000000000000 --severity HIGH,CRITICAL
toil contrast libraries get --app abc12345-0000-0000-0000-000000000000 --hash 0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c
```
