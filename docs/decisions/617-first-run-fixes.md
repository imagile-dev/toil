# Three first-five-minutes fixes: config writes, piped stdin, refused credentials (#617)

- **A connections command that asks questions re-reads the config file before it
  writes, and changes only its own connection.** `login`, interactive `add` and
  `writes on` all read the file, waited on a person, then wrote back the copy they
  had read, so a connection another toil saved meanwhile was lost. Each now reads
  the file again just before writing (`rereadConnection` and `saveNew` in
  `src/connections/commands.ts`) and leaves everything else as it found it, rather
  than refusing whenever the file changed at all: an unrelated change elsewhere in
  the file is no reason to make the person type a secret again. If the connection
  itself was removed or moved to another area meanwhile (or, for `add`, the name was
  taken), it refuses with `INVALID_INPUT`, saying the file changed while it waited,
  before anything goes to the credential store. No new error code: a refusal to act
  on a name is what `INVALID_INPUT` already means here. The commands that don't wait
  on a person (`remove`, `default`, `add --set`) read and write back to back and are
  unchanged.
- **`-` (stdin) is read synchronously, waiting out EAGAIN, rather than made async.**
  `ctx.files.readText` and `readBytes` are synchronous and have about fifty callers,
  so the fix lives in the one place they meet: `nodeFiles` reads fd 0 with
  `readAllSync` (`src/core/stdin.ts`), which on EAGAIN sleeps 10 ms with
  `Atomics.wait` and reads again until end of file. The cause is that the CLI touches
  `process.stdin` (to ask whether it's a terminal), which makes a piped stdin
  non-blocking. Not touching it was considered and rejected: anything else that ever
  reads `process.stdin` would bring the bug back. While it waits the thread is
  blocked, as `readFileSync` is on a blocking pipe; Ctrl+C in a pipeline ends the
  writer too, which closes the pipe and ends the wait. `readStream` was already async
  and is unchanged.
- **A redirect to a service's sign-in host is `AUTH`.** An area's request hook may
  name `signInDomains` (`src/core/api.ts`, `src/core/rest.ts`); a cross-origin
  redirect to one of them (or a subdomain) is `AUTH` with the area's `authFix`, and is
  still never followed. Azure DevOps Services names `vssps.visualstudio.com`, seen
  live, and `login.microsoftonline.com`, its Entra sign-in host, not seen live but
  never a host a `baseUrl` should point at. Server connections name none.
- **A success response whose headers say the credential was refused is `AUTH`.** An
  area's hook may give `refusedWhen(headers)`; Jira Cloud's is
  `X-Seraph-LoginReason: AUTHENTICATED_FAILED`. Seen live on 2026-11-16: with a wrong
  API token, `project/search` answers 200 with no projects and that header, `myself`
  answers 401 with it, and a call with no credential at all gets 200 without it, so
  the header marks exactly the refused credential. Only Cloud uses it; Data Center
  sends a personal access token as Bearer, and its behaviour with a bad one hasn't
  been seen live. Confluence Cloud answered 403 to the same wrong token, already
  `AUTH`, so it needs nothing. Both changes are listed as divergences
  (`docs/divergences/ado.json`, `docs/divergences/jira.json`, principle 4).
- **`toil connections test` for Jira Cloud needed no change.** Its probe is already
  `/rest/api/3/myself`, which answered the wrong token with 401, so it reports `AUTH`.
- **Not done here:** a hint at the secret prompt when a token's length or prefix looks
  like another product's (an Atlassian token pasted into an Azure DevOps prompt).
  It's a separate feature of `askCheckedSecret`, and with the two fixes above the
  first call with the wrong token now says `AUTH` plainly.
