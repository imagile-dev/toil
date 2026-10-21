# Claude, live on the sandbox (#318)

Not run yet past the sign-in. On 21 October 2026, on Windows 11 with Claude Code
2.1.294 and `@anthropic-ai/claude-agent-sdk` 0.3.289, Toil UI started with
`node ui/scripts/dev-real.mjs` against the `imagile-dev/toil-sandbox` dossier.

| Feature | What ran | Result |
|---|---|---|
| One-press SDK install | `GET` then `POST api/agent/install` for Claude | `added 8 packages`, `installed: true`, 0.3.289 |
| A question, signed out | "Backlog hygiene" with Claude's model set to `haiku` | refused before any model ran: "Claude failed: Claude Code answered with an error: Not logged in · Please run /login", fix "Check that Claude Code is signed in (run claude once on its own), then ask again." |

**Why it stops there.** The scratch home hides `~/.claude`, and the sign-in on this
machine held only a refresh token: its access token had expired. Any use of it would
refresh it, rewriting `~/.claude/.credentials.json`, which this run was not to change.
`dev-real.mjs` now reads an unexpired access token, read-only, and says when there is
none (`ui/README.md`, Ask with Claude, on Haiku). With a fresh token, the rest is the
same run as Copilot's: `npm run verify:ui -- --ask --adapter claude --model haiku`,
then each feature in `copilot.md`.

**Found on the way.** Claude Code reports its own "Not logged in" as an assistant
message from the model `<synthetic>` with zeroed usage, and Toil UI stored that as a
usage row. It's now no report at all.
