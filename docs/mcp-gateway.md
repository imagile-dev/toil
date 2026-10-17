# MCP gateway (proposed, not v1)

Tracking: [#4](https://github.com/imagile-dev/toil/issues/4)

## Why

`toil mcp` is stdio-only, so it runs next to the agent and listens on no port. That
fits the engineer on a locked-down laptop, but not:

- a team that wants one shared, centrally configured endpoint
- CI runners and hosted agents that can't spawn a local process
- clients that only speak remote MCP

## Shape

- **Separate package.** For example `@imagile-dev/toil-gateway`, depending on the same
  core. Approving `@imagile-dev/toil` must never mean approving a server (principle 1).
- **Streamable HTTP** transport, on the official MCP TypeScript SDK (pure JS).
- **Authentication is mandatory.** There is no unauthenticated mode, not even on
  localhost, and the gateway refuses to start without auth configured.
- **Same rules as `toil mcp`.** `--areas` scoping, write tools registered only when
  writes are enabled, deletes never exposed, the same JSON envelope.
- **No executables at all.** Pure JS on Node. It shares no filesystem with its callers, so it has no workspace and no git to run.

## Open questions

1. **Client auth.** A static bearer token per client is simple and fits the
   Authentication Bar. Does anyone need OAuth 2.1 as an MCP authorization server, and
   is that worth the complexity?
2. **Whose credentials reach the tools?** A gateway with shared service credentials is
   easy but erases per-user audit trails. Per-user pass-through keeps them, but the
   gateway then holds or forwards everyone's tokens.
3. **Who can enable writes?** On a shared gateway, `writes: true` is an operator
   decision affecting every client. Should writes need per-client grants as well?
4. **Audit log.** What gets logged per call (client, tool, target, outcome) without
   ever logging a secret or a query result?
5. **Hosting.** Where does it run, and what does that cost? Any cloud resource follows
   **Cloud Cost** in CLAUDE.md: priced and approved before it exists.
6. **Rate limits and timeouts** for a shared endpoint, so one client can't starve the
   rest.

## Not in scope

Running the gateway as a hosted service operated by Imagile. This is software people
run themselves.
