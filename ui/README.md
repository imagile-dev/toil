# Toil UI

A local web app for seeing work across Jira, Azure DevOps and GitHub, read through
[toil](https://www.npmjs.com/package/@imagile-dev/toil): one dashboard per dossier,
with its stories, pull requests, builds and deployments side by side.

**Status: alpha, local only.** It runs on your own machine, binds loopback, and
reads through toil with your own connections and dossiers, read-only. It is a
separate package from toil: installing toil never installs it.

## Start it

```bash
npx @imagile-dev/toil-ui
```

It needs Node 24.14 or later and installs one dependency, `@imagile-dev/toil`, at
the exact version it was built with. Until a version shows on
[npm](https://www.npmjs.com/package/@imagile-dev/toil-ui), run it from a clone of
the repository:

```bash
npm ci --ignore-scripts
npm run build -w ui
node ui/dist/server/toil-ui.js
```

It prints one URL and keeps running until you press Ctrl+C:

```text
Toil UI 0.1.0-alpha.1 (alpha, local only), on toil 0.1.0-alpha.3
Reading through toil, read-only, with your own connections and dossiers.

Open this URL in your browser. It carries this launch's token, so keep it to yourself:
  http://127.0.0.1:53117/?token=<token>
```

Open that URL. The page trades the token for a session it keeps in memory, and the
token leaves the address bar. A reloaded page forgets its session, so open the URL
again to get back in. Each start prints a new token. Toil UI opens no browser
itself.

`toil-ui --sample` serves the sample dossiers and the scripted agent the site's
preview uses, with nothing connected to a tracker.

## What it reads

Each dashboard reads its dossier the way `toil dossiers show` describes it: the
Jira project, the Azure DevOps project and pipelines, the GitHub repository and
project board, and the OpenShift namespace of each environment. Every call runs
in-process through `@imagile-dev/toil/api`, read-only, and toil's audit log
records it with `via: "api"` and `caller: "toil-ui"`. A call that fails shows on
its own panel with toil's message and fix.

The page can run only the reads the dashboards make: `dossiers list` and `dossiers
show`, and each area's search, history, pull request, build and deployment reads.
Any other command is refused before it reaches toil, and a change to a tracker is
never made from the page.

## The lock on the door

Any program on the machine, or a web page using DNS rebinding, can reach a local
port, so the server lets in only the browser holding this launch's token:

- **The token.** A random token per start, in the URL it prints. The page trades it
  for a session id, which it keeps in memory and sends as a header on every API
  call. Nothing is kept in a cookie: a browser would send one to any other server
  on `127.0.0.1`, whatever its port.
- **The Host header.** Only the exact `127.0.0.1:<port>` it printed is answered.
- **No CORS.** No `Access-Control-*` header is ever sent. Every POST also needs the
  page's own `Origin`, a JSON body, and the session's CSRF token.
- **No network but toil's.** It talks to the hosts in your toil connections, and
  nothing else.

## Settings

| Setting | Flag | Env var | Default |
|---|---|---|---|
| Bind address | `--host` | `TOIL_UI_HOST` | `127.0.0.1` (`::1` is the other choice) |
| Port | `--port` | `TOIL_UI_PORT` | `0`: the OS picks a free one |
| Base path | `--base-path` | `TOIL_UI_BASE_PATH` | `/` |
| Data folder | `--data-dir` | `TOIL_UI_DATA_DIR` | `~/.toil-ui` |

A flag beats its env var. Any bind address other than loopback is refused in this
release. The data folder is Toil UI's own, apart from toil's `~/.toil/`, and is
kept for the local cache.

## Not in this alpha

- **The local cache.** Every dashboard reads live through toil when it opens.
- **The agent.** The agent pane has no adapter yet, and says so when asked.
- **Settings pages** for connections and dossiers. Use `toil connections` and
  `toil dossiers` on the CLI.
- **Serving other machines.** It is local only.

## The package

`@imagile-dev/toil-ui` ships the server (`dist/server/toil-ui.js`) and the built app
(`dist/app/`), and nothing else. It has no install scripts and no native addons,
spawns no program, and its front end's framework is built in rather than
installed.

Apache-2.0. See `NOTICE` for what the app bundles.
