# First-five-minutes fixes: config writes, piped stdin, refused credentials, the keychain under another HOME (#617)

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
  unchanged. A change that lands in the moment between storing the secret and
  writing the file (`withdrawStored`) deletes the entries just stored unless the file
  as it is now uses them, and the refusal says if any stayed. The one case it can't
  undo: `login` stores under the deterministic `<name>.<key>`, so a value that was
  already there is overwritten before the change is seen. The window is one call to
  the store; closing it would mean a lock file, more machinery than it's worth.
- **`-` (stdin) is read synchronously, waiting out EAGAIN, rather than made async.**
  `ctx.files.readText` and `readBytes` are synchronous and have about fifty callers,
  so the fix lives in the one place they meet: `nodeFiles` reads fd 0 with
  `readAllSync` (`src/core/stdin.ts`), which on EAGAIN sleeps 10 ms with
  `Atomics.wait` and reads again until end of file. The cause is that the CLI touches
  `process.stdin` (to ask whether it's a terminal), which makes a piped stdin
  non-blocking. Not touching it was considered and rejected: anything else that ever
  reads `process.stdin` would bring the bug back. While it waits the thread is
  blocked, as `readFileSync` is on a blocking pipe; Ctrl+C in a pipeline ends the
  writer too, which closes the pipe and ends the wait. Because the command's timer
  can't fire while the thread waits, execute() hands the read its deadline
  (`ReadOptions.deadline`, `src/core/run.ts`) and the wait checks it, ending as
  `TIMEOUT` with the same fix the timer gives. Ctrl+C is the gap that remains: a
  writer outside the shell's process group (a FIFO, a background job) keeps the wait
  going until the time limit, since the SIGINT listener can't run either. That is
  put to the maintainer on the PR. `readStream` was already async and is unchanged.
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
- **macOS `security` runs with `HOME` set to the account's own home** (`accountHome`
  in `src/core/keychain.ts`), read from the user database with `os.userInfo()`, never
  from `$HOME`. `security` finds the login keychain and the search list under
  `$HOME/Library`, so with HOME pointed elsewhere (Toil UI's isolated homes, a
  sandboxed shell) every entry read as not found. Passing the keychain path to
  `security` instead was rejected: it would stop finding an entry in any other
  keychain on the user's search list, which `add-generic-password` with no keychain
  argument may have written to. Where the user database can't be read, HOME is left
  as it is. Windows and Linux stores don't depend on HOME and are unchanged.
- **A secret that couldn't be read from the store is named in the error itself**,
  with the store's reason (`resolveSecrets` in `src/core/connection.ts`): "apiToken is
  keychain:jira.apiToken, which couldn't be read: there is no such entry in the OS
  credential store". It was only a `CONFIG_SECRET_UNRESOLVED` warning beside an error
  that said "missing or has invalid". The reference is named, never used as the value,
  and the warning stays.
- **Not done here:** a hint at the secret prompt when a token's length or prefix looks
  like another product's (an Atlassian token pasted into an Azure DevOps prompt).
  It's a separate feature of `askCheckedSecret`, and with the two fixes above the
  first call with the wrong token now says `AUTH` plainly.
