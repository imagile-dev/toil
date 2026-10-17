---
area: jenkins
description: Jenkins jobs, builds, console logs and triggering builds, on one or more named instances
---

# Jenkins (`jenkins`)

Jobs, builds, console logs and the build queue on **Jenkins**, through its classic
remote access API (`/api/json` with `tree`, `consoleText`, `/queue/item`). Every
command reads except `pipeline run`, which triggers a build. Verification level:
`unit`.

**Supported versions:** The oldest Jenkins version toil supports hasn't been established. toil
calls the classic remote access API with a user name and API token sent as Basic auth.
No release has been verified yet.

## Credential

A Jenkins **API token** and the user name it belongs to: in Jenkins, your user name →
Security → API Token → Add new token. toil sends `Authorization: Basic
base64(username:apiToken)`; both parts are required. No CSRF crumb is requested,
and there is no password or browser login.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_JENKINS_BASE_URL` | yes | Jenkins server root, e.g. `https://jenkins.imagile.dev` (keep any context path) |
| `username` | `TOIL_JENKINS_USERNAME` | yes | Jenkins user name the API token belongs to |
| `apiToken` | `TOIL_JENKINS_API_TOKEN` | yes | Jenkins API token |
| `instance` | `TOIL_JENKINS_INSTANCE` | no | The name `--instance` selects this connection by, when it isn't the connection's own name |

There's no CI fallback variable. Environment variables (CI, or a one-off shell)
configure the default connection:

```bash
export TOIL_JENKINS_BASE_URL=https://jenkins.imagile.dev
export TOIL_JENKINS_USERNAME=ci-bot
export TOIL_JENKINS_API_TOKEN=<your API token>
```

## Named instances

Each Jenkins server is its own connection. `--instance <name>` (on the group:
`toil jenkins --instance ephemeral pipeline list`, or the `instance` field over MCP)
selects the jenkins connection with that name, or the one whose `instance` setting is
that name. An unknown name is `INVALID_INPUT`, listing the ones toil knows. Without
`--instance`, the area's default connection is used.

```json
{
  "version": 2,
  "connections": {
    "jenkins": { "area": "jenkins", "baseUrl": "https://jenkins.imagile.dev", "username": "ci-bot" },
    "ephemeral": { "area": "jenkins", "baseUrl": "https://jenkins-tmp.imagile.dev", "username": "tmp-user" }
  },
  "defaults": { "jenkins": { "connection": "jenkins" } }
}
```

The API token never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Add an instance with `toil connections add ephemeral --area
jenkins`, which asks for each setting and keeps the token in the OS credential
store; remove one with `toil connections remove ephemeral`. In CI, define one with
`TOIL_CONN_EPHEMERAL_AREA=jenkins` and `TOIL_CONN_EPHEMERAL_BASE_URL`, `_USERNAME`
and `_API_TOKEN`.

- `instance list`: List configured Jenkins instances. It is `toil connections list
  --area jenkins`: every jenkins connection's name, host, whether it's the default,
  whether writes are on, and where each setting came from, never a secret. Over MCP,
  call `connections_list` with `area: "jenkins"`.
- `instance add <name>`: CLI only. It is `toil connections add <name> --area
  jenkins`, asking for each setting on a terminal and keeping the token in the OS
  credential store. The documented `--name`, `--base-url`, `--username`, `--api-token` and
  `--force` flags are gone.
- `instance remove <name>`: CLI only. It is `toil connections remove <name> --area
  jenkins`, which also deletes the token from the OS credential store and refuses a
  connection to another area. The documented `--name` flag is gone.

## Commands

Job names with folders are written `folder/job` (`platform/api-build`); each level
becomes `/job/<segment>`, percent-encoded.

- `pipeline list`: List all jobs on the Jenkins instance (or within a folder, `--folder parent/child`).
- `pipeline get`: Get details for a specific job (`--name`), with its last 10 builds.
- `pipeline run`: Trigger a build (`--name`). It writes, so it needs `writes: true`
  on the connection and `--allow-write`. Each `--parameter key=value` (repeatable)
  sends the build to `buildWithParameters`; without one it goes to `build`, even for
  a parameterized job. Without `--wait`, `data` is `{ queueItemId }`. With `--wait`
  it polls every `--poll` seconds (default 10) until the build leaves the queue, then
  until it finishes, giving each phase `--timeout` seconds (default 600), and returns
  the build. A build whose result is set and isn't `SUCCESS` is still returned as
  `data` with `ok: true`, but the CLI exits 1, and `meta.warnings` has a
  `JENKINS_BUILD_NOT_SUCCESSFUL` warning (over MCP, check the warning or
  `data.result`).
  The command's time limit is 21 minutes (`TOIL_TIMEOUT_MS` overrides it).
  `--timeout` and `--poll` are checked only after the build was triggered.
- `pipeline list-runs`: List recent builds for a job (`--name`, `--top`, default 25).
  Jenkins' `builds` list holds only the newest 100.
- `pipeline get-run`: Get details for a specific build (`--name`, `--number`).
- `pipeline logs`: Fetch console log for a build (consider --output-file for large
  logs); `data` is `{ log }`, the whole text.

`--number`, `--top`, `--timeout` and `--poll` are read as whole numbers from the
start of the text, so `12abc` is 12.

```bash
toil jenkins pipeline list --folder platform
toil jenkins --instance ephemeral pipeline list-runs --name platform/api-build --top 5
toil jenkins pipeline run --name api-build --parameter BRANCH=main --wait --allow-write
```
