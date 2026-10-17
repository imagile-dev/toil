# Integration briefs

One short page per area still to build, distilled from the contract
(the package named in `docs/command-contract.json` under `source`; each area's code is
in the contract) and from the integration kit's audit (#68). A brief is where
an integration starts: it says what the area needs from core before anyone reads the contract
line by line. The source stays the specification (CLAUDE.md, Building), and a brief that
disagrees with it is wrong.

Briefs are the one place outside `docs/command-contract.*` and issues that may point at
the contract's source, because an integration needs it (maintainer
decision, #68). Shipped docs, code and skills never do. **The PR that builds an area
deletes its brief.**

Every brief has the same sections:

| Section | What it says |
|---------|--------------|
| Header | Wave, the integration issue, the suspected-bug issue, how many contract commands |
| Commands | The contract's command paths, grouped |
| Auth | The credential, the config keys and their env vars, the header it becomes, and any token exchange |
| Paging | Which paging scheme each list uses, and its defaults and caps |
| Special HTTP needs | Anything beyond JSON over GET/POST: multipart, raw bodies, NDJSON, binary downloads, server-supplied URLs, polling, response headers it reads, non-OK statuses it accepts, repeated query keys, GraphQL, long timeouts |
| Context inputs | Group-level flags and per-command defaults that come from config or the git remote |
| Supported version | The oldest server or API version, or "not established" with what is known |
| Watch for | Behavior an integration could get wrong, and suspected bugs to pin rather than fix |

## Waves

| Wave | Areas |
|------|-------|
| 1. Plain HTTP | [artifactory](artifactory.md), [confluence](confluence.md), [jenkins](jenkins.md), [bitbucket](bitbucket.md), [github](github.md), [figma](figma.md), [splitio](splitio.md), [elasticsearch](elasticsearch.md), [logscale](logscale.md), [kibana](kibana.md) |
| 2. Exchange, polling, header-only auth, environments | [ado](ado.md), [dynatrace](dynatrace.md), [openshift](openshift.md), [saucelabs](saucelabs.md), [sde](sde.md), [contrast](contrast.md), [sonatypeiq](sonatypeiq.md), [checkmarx](checkmarx.md), [alation](alation.md), [osv and ossindex](osv-ossindex.md) |
| 3. Local | [git](git.md), [deps](deps.md) |

An integration starts with `node scripts/stub-area.mjs <area>`, then this brief, then the
`integrations` skill's integration steps.
