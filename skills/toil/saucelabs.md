---
area: saucelabs
description: Sauce Labs test jobs, builds, real devices and device sessions, tunnels, platforms, app storage metadata and teams
---

# Sauce Labs (`saucelabs`)

Test jobs on virtual devices and desktop browsers, real-device jobs, builds, the
real-device catalog, Real Device Access sessions (reserve a device, open URLs,
install apps, run ADB shell commands, record tests, throttle the network, start
Appium), Sauce Connect tunnels, app storage metadata and teams, on **Sauce Labs**.
Verification level: `unit`.

**Supported versions:** The oldest Sauce Labs version toil supports hasn't been established. Sauce Labs is
SaaS only, so there is no server release to pin. toil calls the REST v1 and v1.2,
Real Device Access v2, Builds v2, Team Management v1 and Storage v1 APIs on the
data-center host in `baseUrl`. Nothing has been verified against a live account yet.

## Credential

Your Sauce Labs **username and access key**: in Sauce Labs, User settings → Access
key. toil sends them as `Authorization: Basic base64(username:accessKey)`, and puts
the username in most `/rest/v1/<username>/...` paths. There is no token exchange,
password or browser login. `toil saucelabs concurrency` is the cheapest check that
the two belong together: Sauce has no "current user" endpoint, and that one is
scoped to the username.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_SAUCELABS_BASE_URL` | yes | Your account's data-center API endpoint, e.g. `https://api.us-west-1.saucelabs.com` (`https://api.eu-central-1.saucelabs.com` in the EU). There's no default |
| `username` | `TOIL_SAUCELABS_USERNAME`, then `SAUCE_USERNAME` | yes | Sauce Labs username |
| `accessKey` | `TOIL_SAUCELABS_ACCESS_KEY`, then `SAUCE_ACCESS_KEY` | yes | Access key |

**CI fallbacks:** when `TOIL_SAUCELABS_USERNAME` or `TOIL_SAUCELABS_ACCESS_KEY` isn't
set, the default connection takes the value from `SAUCE_USERNAME` or
`SAUCE_ACCESS_KEY`, the variables saucectl, Sauce Connect and Sauce's own CI docs
read. Each sits directly below its `TOIL_` variable and above the config file.
There's no fallback for the base URL.

Environment variables (CI, or a one-off shell):

```bash
export TOIL_SAUCELABS_BASE_URL=https://api.us-west-1.saucelabs.com
export TOIL_SAUCELABS_USERNAME=<your username>
export TOIL_SAUCELABS_ACCESS_KEY=<your access key>
```

Or `~/.toil/config.json`:

```json
{
  "version": 2,
  "connections": {
    "sauce": { "area": "saucelabs", "baseUrl": "https://api.us-west-1.saucelabs.com", "username": "imagile" }
  },
  "defaults": { "saucelabs": { "connection": "sauce" } }
}
```

The access key never goes in this file; a plaintext one there is refused with
`CONFIG_INVALID`. Run `toil connections add sauce --area saucelabs` (or
`toil connections login sauce` for an existing connection) to keep it in the OS
credential store, or set `TOIL_SAUCELABS_ACCESS_KEY`.

## Commands

Ids are positional arguments: `<job-id>`, `<build-id>`, `<device-id>`,
`<session-id>`, `<tunnel-id>`, `<team-id>`. Over MCP they're fields (`jobId`,
`sessionId`, ...). Enum values are matched ignoring case. Integer flags take whole
numbers 0 or more. Time flags (`--from`, `--to`, `--start`, `--end`) take Unix
seconds or an ISO 8601 date; give the date-time an offset (`2026-09-01T00:00:00Z`),
because one without is read in the machine's local time zone.

Account and platform:

- `status`: Sauce Labs service status (operational flag, wait time)
- `concurrency`: Concurrency allowed and in use for your organization and team (also verifies credentials)
- `platform list`: Supported OS/browser/device platforms (`--api all|appium|webdriver`, default `all`); `data` is `{ api, count, platforms }`
- `appium-version list`: Appium versions available for real-device sessions, with end-of-life dates
- `user list`: Look up users in your organization (`--username`, `--phrase`, `--limit` (default 20, max 100), `--offset`)

Jobs on virtual devices and desktop browsers, under your username:

- `job list`: List your recent jobs (`--limit`, `--offset`, `--from`, `--to`); `data` is `{ count, jobs }`
- `job get`: Get one job: status, platform, timings, and log/video URLs
- `job update`: Update a job's name, build, tags, result, or visibility (`--name`, `--build`, `--tags` (repeatable or comma-separated; replaces the existing tags), `--passed` or `--failed`, `--public public|public restricted|share|team|private`). At least one is required, checked before any request
- `job stop`: Stop a running job
- `job delete`: Delete a job and all of its assets; `data` is `{ jobId, deleted: true }`
- `job assets`: List the asset files a job produced (logs, video, screenshots) — names only, no download; `data` is `{ jobId, assets }`

Real-device jobs:

- `rdc-job list`: List real-device jobs (`--limit`, `--offset`, `--live` for manual tests only)
- `rdc-job get`: Get one real-device job: device, result, timings, and log URLs
- `rdc-job update`: Update a real-device job's name, build, tags, or result (`--name`, `--build`, `--tags`, `--passed` or `--failed`)
- `rdc-job stop`: Stop a running real-device job; `data` is `{ jobId, stopped: true }`
- `rdc-job delete`: Delete a real-device job (owner, team admin, or org admin only); `data` is `{ jobId, deleted: true }`

Builds (`--source vdc|rdc`, default `vdc`):

- `build list`: List builds (`--status` repeatable or comma-separated, each sent as its own `status=` parameter: running, error, failed, complete, success; `--name`, `--start`, `--end`, `--limit`, `--offset`, `--sort asc|desc`); `data` is `{ source, count, builds }`
- `build get`: Get one build with its job counts
- `build jobs`: List the jobs in a build (`--failed`, `--errored`, `--passed`, `--running`, `--queued`, `--completed`, `--finished`, `--faulty`, `--modified-since`, which is sent as typed); `data` is `{ buildId, source, count, jobs }`
- `job build <job-id>`: Get the build a job belongs to

Real devices:

- `device list`: List real devices your account can use (`--name` regex, `--os android|ios`, `--os-version`, `--type phone|tablet`); `data` is `{ count, devices }`
- `device get`: Get one device's full descriptor (hardware, OS, screen)
- `device status`: Live availability of real devices (AVAILABLE, IN_USE, CLEANING, ...) (`--state`, `--name`, `--private-only`)

Real-device sessions (Real Device Access API):

- `session list`: List your device sessions (`--state`, `--device-name`); `data` is `{ count, sessions }`
- `session create`: Reserve a real device. Returns immediately in PENDING state unless --wait is passed (`--device-name`, `--os android|ios`, `--tunnel-name`, `--tunnel-owner` (needs `--tunnel-name`), `--duration` as ISO 8601, e.g. `PT30M`). `--wait` polls every 5 s until the session is ACTIVE, and fails if it closes or errors, or when it's still starting after `--timeout` seconds (default 300). It gives up when the next poll would land past the timeout, so up to 5 s early; the session keeps starting in the background. The command's time limit is an hour (`TOIL_TIMEOUT_MS` overrides it)
- `session get`: Get a session: state, device, expiry, Appium URL, and live-view link
- `session delete`: Close a session and release the device (`--reboot`, private devices only)
- `session open-url`: Open a URL on the device (Chrome on Android; Safari or a deep link on iOS): `session open-url <session-id> <url>`
- `session shell`: Run an ADB shell command on an Android device (public devices allow only a safe subset): `session shell <session-id> <command>`; `data` is `{ sessionId, command, stdout }`. It waits up to 120 s for the device
- `session install-app`: Install an app from Sauce app storage onto the device (runs in the background): `session install-app <session-id> <app>`, where `<app>` is `storage:<file-id>` or `storage:filename=<name>` (`--launch`, `--no-instrumentation`)
- `session installations`: List app installations on the device and their status
- `session launch-app`: Launch an installed app (exactly one of `--bundle-id` or `--package-name`; `--activity` needs `--package-name`)
- `session uninstall-app`: Uninstall an app (exactly one of `--bundle-id` or `--package-name`)
- `session settings`: Change device settings: orientation (both), locale and animations (Android only) (`--orientation portrait|landscape`, `--locale`, `--animations on|off`); `data` is `{ sessionId, applied }`
- `session start-test`: Start recording a test (a job) inside the session (`--name`, `--build`, `--tags`, `--video`, `--device-logs`, `--network-capture`, `--screenshots`, `--appium-logs`)
- `session end-test`: End the active test in the session, optionally recording its result (`--passed` or `--failed`)
- `session tests`: List the tests recorded in a session, with links to each job
- `session network-profiles`: List the network throttling profiles available to a session
- `session network`: Throttle the device network with a named profile or explicit conditions, or --reset to clear (exactly one mode: `--profile`, `--reset`, or any of `--download` and `--upload` (0-50000 kbps), `--latency` (0-3000 ms) and `--loss` (0-100 %))
- `session appium`: Get the session's Appium server URL, or --start one (`--appium-version` needs `--start`)

Sauce Connect tunnels, under your username:

- `tunnel list`: List your tunnels with full details (`--all` adds tunnels shared with you). With `--all` Sauce may answer with an object keyed by owner, in which case `data.tunnels` is that object and `count` is absent
- `tunnel get`: Get one tunnel
- `tunnel jobs`: Number of jobs currently running through a tunnel
- `tunnel stop`: Shut down a tunnel

App storage (metadata only; no upload or download):

- `storage files`: List uploaded app files (`--query`, `--kind android|ios`, `--page` (starts at 1), `--page-size` (max 100))
- `storage groups`: List app groups (all versions of one app), with the same flags

Teams:

- `team list`: List teams (`--name` prefix)
- `team get`: Get one team and its settings
- `team members`: List a team's members

Lists are one request each, with the paging parameters passed straight through;
`count` is the length of the list Sauce returned, and is absent when the answer
isn't a list. Sauce's error bodies (`{ "detail": "..." }`) become the error message.

## Writes

`job update`, `stop` and `delete`; `rdc-job update`, `stop` and `delete`; `tunnel
stop`; and every `session` command that acts on a device (`create`, `delete`,
`open-url`, `shell`, `install-app`, `launch-app`, `uninstall-app`, `settings`,
`start-test`, `end-test`, `network`, `appium`) change something in Sauce Labs. Each
needs `writes: true` on the connection and `--allow-write` on the call. `session
appium` needs both even to read the URL, because the same command can start a server.

`job delete`, `rdc-job delete`, `session delete` and `tunnel stop` delete something, so
they run on the CLI only and are never MCP tools.

```bash
toil saucelabs concurrency
toil saucelabs job list --limit 20 --from 2026-09-01T00:00:00Z
toil saucelabs build list --source rdc --status failed,error
toil saucelabs session create --device-name "iPhone 15.*" --os ios --wait --allow-write
toil saucelabs session shell <session-id> "getprop ro.build.version.release" --allow-write
```
