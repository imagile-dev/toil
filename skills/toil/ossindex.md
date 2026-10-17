---
area: ossindex
description: Known vulnerabilities for a dependency inventory, from the public Sonatype OSS Index API
---

# Sonatype OSS Index (`ossindex`)

Known vulnerabilities for the packages in a dependency inventory, from the public
**Sonatype OSS Index** API (`https://ossindex.sonatype.org`), asked anonymously. It
reads only and needs no connection. Verification level: `unit`.

**Supported versions:** OSS Index REST API v3 or later

## Credential and configuration

None. toil sends OSS Index no credential, and the command names the service, so
toil talks to `https://ossindex.sonatype.org` and nothing else. There is no
connection to add, no `TOIL_OSSINDEX_*` variable and no `--connection` flag. toil
uses `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY` when they're set.

**This command currently fails.** Sonatype documents that OSS Index now requires an
account's API token on every request, and anonymous requests get HTTP 401. toil has
no setting for a token yet, so the reachability check fails with "not reachable"
(`error.details.cause` is `HTTP 401`). Use `toil osv vulns` instead until a token
setting ships.

## Commands

### `toil ossindex vulns`

Checks an inventory from `toil deps scan` against OSS Index. MCP tool:
`ossindex_vulns`.

```bash
toil deps scan --include-transitive | toil ossindex vulns
toil ossindex vulns --from inventory.json --ecosystem maven
```

| Flag | Meaning |
|------|---------|
| `--from <file>` | A file holding `toil deps scan` output: its whole envelope, its `data`, or a bare list of `{ name, version, ecosystem }`. Omitted, the inventory is read from stdin on the CLI. Over MCP pass `from`; there is no stdin |
| `--ecosystem <ecosystem>` | `npm`, `nuget`, `maven` or `all` (default). Any other value matches nothing and returns a clean result |
| `--direct-only` | Leave out packages the inventory marks `transitive` |
| `--include-dev` | Keep packages the inventory marks `dev` (left out by default) |

It first checks OSS Index answers (an empty list of coordinates), then sends
`POST /api/v3/component-report` with up to 128 package URLs a request, one request
after another: `pkg:npm/%40scope/name@1.0.0`, `pkg:nuget/Name@1.0.0`,
`pkg:maven/<group>/<artifact>@1.0.0`. Reports are matched back by their exact
`coordinates`; one OSS Index returns in another form is dropped.

Output is the same shape `deps frisk --source sonatype` had, so `source` is
`sonatype`:

```json
{
  "tier": "full", "source": "sonatype", "sourcesQueried": ["sonatype"], "sourceErrors": [],
  "scanned": 4, "vulnerable": 1,
  "packages": [{
    "name": "org.apache.logging.log4j:log4j-core", "version": "2.14.1", "ecosystem": "maven", "source": "pom.xml", "type": "direct", "scope": "production",
    "vulnerabilities": [{
      "id": "CVE-2021-44228", "summary": "[CVE-2021-44228] Improper input validation", "severity": "CRITICAL", "cvss": 10,
      "aliases": ["CVE-2021-44228"],
      "remediation": { "fixAvailable": false, "fixedVersions": [], "advice": "See https://ossindex.sonatype.org/vulnerability/CVE-2021-44228 for remediation details for org.apache.logging.log4j:log4j-core@2.14.1." },
      "references": ["https://ossindex.sonatype.org/vulnerability/CVE-2021-44228"]
    }]
  }]
}
```

`id` is the vulnerability's display name, `severity` comes from its CVSS score (9
CRITICAL, 7 HIGH, 4 MEDIUM, above 0 LOW, else UNKNOWN), and `aliases` are the CVE ids
found in its name, title and description. OSS Index gives no fixed versions, so
`fixAvailable` is always `false`.

## Errors

- `INVALID_INPUT`: the inventory isn't JSON, is a failed result, has no packages
  list, or has a package without a name, version or ecosystem. Nothing is sent.
- `NETWORK`: "toil ossindex vulns requires Sonatype OSS Index access but
  ossindex.sonatype.org is not reachable from this machine." The reachability check
  failed; `error.details.cause` says how.
- `HTTP`: "Sonatype OSS Index is rate-limiting requests from this IP…" on a 429. The
  message suggests adding credentials, but toil doesn't send any yet; wait and retry.
- `HTTP`: "Sonatype OSS Index returned HTTP <status>" for any other failed batch.

## Old paths

`deps frisk --source sonatype` ran this check. It isn't an alias yet: use
`toil deps scan | toil ossindex vulns`.
