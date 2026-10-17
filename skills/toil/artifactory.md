---
area: artifactory
description: TODO what the area covers, in one line with no colon and space
---

# TODO service name (`artifactory`)

TODO: what it covers. Verification level: `unit`.

**Supported versions:** TODO, worded exactly as `supportedText()` in src/core/supported.ts words the area's `supported`.

## Credential

TODO: what it is, where to create it, and how toil sends it.

## Configuration

| Key | Env var | Required | Meaning |
|-----|---------|----------|---------|
| `baseUrl` | `TOIL_ARTIFACTORY_BASE_URL` | yes | Server root, e.g. `https://artifactory.imagile.dev` |

## Commands

- `ping`: Check Artifactory connectivity and authentication
- `repos`: List repositories
- `artifact-info`: Get metadata for an artifact or folder (checksums, size, timestamps)
- `properties-get`: Read custom properties on an artifact
- `properties-set`: Set custom properties on an artifact (format: key=value key=value...)
- `search`: Search artifacts using AQL (Artifactory Query Language) (consider --output-file
- `builds`: List builds registered in Artifactory Build Integration (names may differ from
- `build-runs`: List all run numbers for a build
- `build-info`: Get build info (artifacts, dependencies, VCS revision) for a specific run
