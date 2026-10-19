# Security policy

toil holds credentials for the tools it talks to, so a security problem in it can
reach well past this repository. Thank you for reporting one privately.

## Reporting a vulnerability

Report it through GitHub's private vulnerability reporting:
**[Report a vulnerability](https://github.com/imagile-dev/toil/security/advisories/new)**
(the **Security** tab, then **Report a vulnerability**). Only the maintainers see
the report, and the fix and advisory are drafted with you in the same place.

Please don't use a public issue, a pull request, a discussion, or the
[feedback page](https://imagile-dev.github.io/toil/feedback/) for a security
report. Feedback from the site becomes a public issue.

A useful report has:

- the toil version (`toil version`), your OS and your Node.js version
- the command or MCP tool, and the input that shows the problem
- what happened, and what you expected
- the impact as you see it: what an attacker gains, and what they need first

Use placeholders for anything that identifies your environment: hosts as
`<service>.imagile.dev`, IDs as `abc12345`, and never a real token, even a
revoked one.

## What's in scope

Everything in this repository:

- `@imagile-dev/toil`: the CLI, the MCP server (`toil mcp`) and the
  `@imagile-dev/toil/api` entry
- Toil UI (`@imagile-dev/toil-ui`, in `ui/`), which is in alpha
- the GitHub Actions workflows, the feedback function under `functions/feedback/`,
  and the site at https://imagile-dev.github.io/toil/

Particularly welcome: a credential reaching a host other than the connection it
belongs to, a write that gets past the write gate (`writes: true` plus
`--allow-write`), a file path that escapes the workspace or reaches toil's own
config, a spawn outside the reviewed list, and anything an agent can do over MCP
that the CLI refuses. [`docs/bounds.md`](../docs/bounds.md) lists every limit toil
holds itself to and where each is enforced.

Out of scope: vulnerabilities in the services toil connects to (report those to
their vendors), and findings that need an attacker who already controls your
`~/.toil/` folder, your OS credential store or your environment variables.

## Supported versions

toil is in alpha. Fixes land on `main` and ship in the next alpha release; earlier
alphas aren't patched.

| Version | Supported |
|---------|-----------|
| Newest `0.x` alpha | Yes |
| Older alphas | No, upgrade to the newest |

## What happens next

We aim to acknowledge a report within a few working days, agree on the severity
with you, and publish a GitHub security advisory with the fix, crediting you unless
you'd rather not be named.
