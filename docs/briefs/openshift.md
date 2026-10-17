# OpenShift / Kubernetes (`openshift`)

Wave 2 · Integration issue #28 · Suspected bugs #88 · 7 contract commands

## Commands

- **cluster:** `list`
- **Top level:** `pods`, `deployments`, `events`, `logs`, `pod-metrics`, `resource-usage`

Every command is read-only. `cluster list` reads config only and needs no connection.

## Auth

- Bearer token, typically a service account token.
- Flat keys: `openshift.baseUrl` (`TOIL_OPENSHIFT_BASE_URL`, for example `https://openshift.imagile.dev`) and `openshift.token` (`TOIL_OPENSHIFT_TOKEN`).
- Named clusters: `openshift.environments.<env>.instances.<instance>.{baseUrl, token}`, plus `openshift.defaultEnvironment` and `openshift.defaultInstance`.
- Header: `Authorization: Bearer <token>`. No token exchange and no CI fallback.

## Paging

None. List calls send no `limit`, so the API server returns the whole list in one response.

## Special HTTP needs

- **Text logs:** `logs` GETs `/api/v1/namespaces/{ns}/pods/{pod}/log` with `Accept: */*`.
  - Query: `tailLines` (`--lines`, default 100), plus `container` and `previous=true` when given.
  - The text goes into the envelope as `log`, alongside `pod`, `namespace`, `container` (`"(default)"` when not given), `previous` and `lines`.
- **CSV (decision 4):** `resource-usage --csv` wrote raw CSV to stdout. The port writes it inside the workspace with `--out <file>`, never overwrites, and returns the saved absolute path in the envelope.
  - `--out` is an addition to the contract. Both `--out` and dropping the stdout CSV are listed in `docs/divergences/openshift.json`.
  - Keep the header exactly: `Pod,Container,CPU Usage (m),Memory Usage (Mi),CPU Limits (m),Memory Limits (Mi),CPU Requests (m),Memory Requests (Mi)`. A `null` becomes an empty cell. Values are not quoted.
- **Parallel requests:** `resource-usage` fetches pods and `metrics.k8s.io/v1beta1` pod metrics at once, and sends `labelSelector` to both. `pod-metrics` and `resource-usage` need metrics-server.
- **API groups:** `deployments` reads `apps/v1` Deployments, or `apps.openshift.io/v1` DeploymentConfigs with `--deployment-configs`.
- Errors: the JSON calls use the shared error parser, which reads the Kubernetes Status `message`. The log call reads only `message` and has no 429 retry.
- Default per-request timeout is 30 s.

## Context inputs

- Group flags: `openshift --env <name> --instance <name>`. In toil they select a connection (K1).
- Contract order:
  1. `--env` and `--instance`, each falling back to `defaultEnvironment` / `defaultInstance`.
  2. When both are known, the named cluster is used, and it must have both `baseUrl` and `token`. Each missing key is its own error, whose fix names the exact config key.
  3. Exactly one of the two known is an error naming the missing flag.
  4. Neither known: the flat keys. A missing `baseUrl` is "not configured". A missing token fails later as "credentials not configured".
- `cluster list` returns `{ count, clusters, defaultEnvironment, defaultInstance }`.
  - `clusters` holds `{ environment, instance, baseUrl }`, with the flat cluster first as `(default)/(default)` when `baseUrl` is set.
  - It never includes tokens.

## Supported version

Not established. The commands use core `v1` (pods, events, logs), `apps/v1`, `apps.openshift.io/v1` and `metrics.k8s.io/v1beta1`. The event mapping falls back to `events.k8s.io` field names (`regarding`, `reportingComponent`, `eventTime`). No version endpoint is called.

## Watch for

- Every #88 item is reproduced exactly:
  - 1: `logs` sends no default container.
  - 2: `ready` counts init containers in the numerator only.
  - 3: named defaults beat the `TOIL_OPENSHIFT_*` env vars.
  - 4: some valid quantities parse to `null`.
  - 5: `oomKilled` checks `lastState` only.
  - 6: `events` reads `count` from the core field only.
  - 7: `--lines` isn't validated.
- **`pods` summary:**
  - Phase counters, plus `crashLoopBackOff`, `imagePullBackOff` (which includes `ErrImagePull`), `oomKilled` and `totalRestarts`.
  - Pods are sorted Failed, then Pending, then Unknown, then the rest, and by restarts within each group.
  - `reason` comes from `status.reason`, or else the first condition with status `False`.
  - `age` is formatted as `s`, `m`, `h` or `d`.
- `--raw` on `pods` and `deployments` returns the unmodified items with `count`.
- **`deployments`:**
  - `ready` is `readyReplicas/desired`.
  - Only problem conditions are kept: Available or Progressing that are `False`, and any ReplicaFailure.
  - Sorted by `unavailableReplicas`, highest first.
- **`events`:** the default field selector is `type=Warning`, joined to `--field-selector` with a comma. `--all` drops the Warning filter. Sorted by `count`, highest first.
- **Units:**
  - CPU handles `n`, `u` and `m` and whole cores, giving millicores.
  - Memory handles `Ki/Mi/Gi/Ti`, `K/M/G` and plain bytes, giving MiB. `Ki`, `K`, `M` and bytes round to 2 places. `Gi`, `Ti` and `G` round to whole numbers.
