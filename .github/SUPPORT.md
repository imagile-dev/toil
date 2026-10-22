# Getting help

## Read first

- **[The docs](https://imagile-dev.github.io/toil/docs/)**: setup, connections and
  every command, one page per area.
- **[How it works](https://imagile-dev.github.io/toil/about/how-it-works/)**: the big
  picture, from the JSON envelope to credentials and MCP.
- **[Connect](https://imagile-dev.github.io/toil/connect/)**: every integration and
  database engine, how each signs in, and how far it has been verified.
- **Your own terminal**: every error carries a `fix` that says what to do next, and
  `toil <command> --help` lists every flag.

## Report a problem or ask for something

- **[The feedback page](https://imagile-dev.github.io/toil/about/feedback/)** on the site,
  or its curl endpoint for networks where the form can't load. Each report becomes
  a public issue, which is redacted (tokens, internal hosts, private IPs) before an
  agent triages it.
- **[A GitHub issue](https://github.com/imagile-dev/toil/issues/new/choose)**, using
  the bug report or feature request form. These are public and not redacted.

Either way, use placeholder hosts (`<service>.imagile.dev`) and never paste a
token, even a revoked one.

## Security

Never through any of the above. See [SECURITY.md](SECURITY.md).

## What to expect

toil is in alpha and maintained by Imagile. There's no support contract or
response-time promise, but every report is read.
