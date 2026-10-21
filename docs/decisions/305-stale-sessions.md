# Stale sessions, recorded fingerprints and one-click renew (#305)

- **`skills` hashes the toil tools a session is handed, one hash per area.** Toil UI
  loads no skill page into its agents (Claude runs with `settingSources: []`, Codex in
  a home of Toil UI's own, and an assignment's record already says "skills: none").
  What toil teaches a Toil UI agent is its tools: each live read's name, description
  and input schema, from the registry the server loaded. Hashing those per area keeps
  the issue's shape (`skills changed: jira, util`) and stays true (principle 4).
  `ui/src/fingerprint.ts`, `skillsOf` in `ui/server/fingerprint.ts`.
- **A session records what the server runs; the current fingerprint reads the builds
  on disk.** So an upgrade on disk marks every session stale at once ("started on toil
  0.1.0-alpha.3 · now alpha.4"), as the issue asks, before anyone restarts. The builds
  come from marked lines at the top of each bundle: toil's existing
  `__TOIL_VERSION__` and `__TOIL_COMMIT__` lines, and a new
  `// toil-ui-build {"version","commit"}` line in Toil UI's bin (vite.server.config.ts,
  which now also defines `__TOIL_UI_COMMIT__` the way tsup finds toil's). Each file is
  read again only when its modification time or size changes. A file that can't be
  read counts as the running build, so a source run never reads as an upgrade.
- **The registry and the prompt text are the running server's.** Neither can be read
  from a newer bundle without loading it, so `skills` and the code half of `prompts`
  change only across a restart (an assignment kept from before). The part of the
  prompts that changes live is the person's own instructions and custom voice, which
  are in the hash. The theme on screen isn't: switching theme isn't the ground moving.
- **The dossier part is hashed from `toil dossiers show` on every check**, not cached
  against the dossier file: toil reads the dossier files itself, in process, and the
  page checks at most once a minute between answers.
- **A chat's fingerprint lives in the server's memory, by chat id**, recorded at its
  first question (a chat is the page's state already, #343). The server keeps the 200
  newest. Every finished answer carries the chat's `session`, and an open chat asks
  `api/agent/session` once a minute between answers.
- **Renewing a chat re-records its fingerprint and nothing else.** Every question
  already starts a fresh SDK run with the current prompt and the chat's last 8 turns
  (#344), which is "a fresh session with the same brief and history summary". The
  chat keeps its id, so its usage total carries on and a renew never resets a
  per-chat cap. Refused (409) while it answers.
- **Which assignments are stale and which renew.** A `done` assignment is closed and
  never marked; a queued one hasn't recorded anything yet. Working, needs-you and
  failed ones are marked when stale. Only a stale `failed` one renews: working is
  mid-turn ("never interrupts a turn"), and needs-you waits on a person ("skips agents
  waiting on a person"). `renewRefusal` in `ui/src/assign/model.ts` says why for each.
  Marking every done assignment after each upgrade would light up the whole lane with
  history, and renewing one would rerun reviewed work.
- **A renewed assignment is a new assignment**, with `renews` and the old one's
  `renewedBy`, so the old transcript stays as it was. Its "history summary" is what
  the old run left (how it ended, its report, questions and proposal titles, cut to
  4,000 characters), fenced in its prompt as data like the tracker item, with every
  fence marker taken out, since an agent wrote it from tracker text.
- **Renew all stale lives in the Agents lane** and lists the dossier's stale
  assignments and its chat (the chat now sits in a `ChatScope` around the dossier's
  pages, so the lane can see it). It renews one by one from the page and reports each.
- **The header's restart command is the process's own argv** (`node <bin> <args>`),
  quoted where a shell would split it.
- **A sample fingerprint.** The sample's needs-you and failed assignments start on
  toil 0.1.0-alpha.3 with Jira's tools since changed, so the preview and `--sample`
  show the badge and Renew all; renewing the failed one there runs the scripted runner.
