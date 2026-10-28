# Analyze remembers the agent picked for each dossier (#494)

- **Stored in Toil UI's data folder, `dossier-agents.json`, beside `agent.json`.** The
  global default already lives there, so the memory follows the same pattern: server
  side, owner-only, written through a temporary file, an adapter name per dossier name
  and nothing else. Not in the browser, so a second browser or a restart sees the same
  thing; not in toil's dossier file, since a preference about Toil UI is Toil UI's
  state, not the dossier's. Not in the cache, because the cache is retention-pruned and
  wiped as ticket content, and a preference is neither.
- **The order is the dossier's remembered agent, then the default from Settings, Agent,
  then the old behaviour.** Each is used only if the adapter list says it is ready
  (installed and its CLI found, as the switcher already judges). With neither ready,
  the chat sends nothing and the server tries Settings' choice and says why it can't,
  as before. The order is a pure function (`ui/src/agent-default.ts`) so it is tested
  without a page.
- **Settings, Agent is left as it was.** It is already a radio choice among Claude,
  GitHub Copilot and Codex (plus None), so it is the global fallback unchanged.
- **Remembered when an Analyze finishes whole and names an agent, by the server.** The
  page sends the adapter it used (a picked one, or a remembered one); the server writes
  the memory only once the answer is whole, the same test the analysis history uses, so
  a stopped, failed or empty run says nothing about preference. A question that is not
  Analyze never writes it. An unpicked chat on the Settings default sends no adapter, as
  before, so nothing is recorded until someone picks.
- **Picking the Settings default in the switcher is now a pick.** The switcher used to
  send "no adapter" for it. It sends the name, so choosing it on a dossier that
  remembered another agent sticks. The palette's "Answer with" does the same.
- **The page reads the memory with the adapter list** (`api/agent/adapters?dossier=`)
  rather than through a new endpoint, and Analyze reads the list itself when the strip
  hasn't yet (the palette and the button start it before the popover opens), so the
  first Analyze never misses the memory. No new toil calls; `registry.test.ts` is
  untouched.
- **Rename moves the key; forget drops it.** The rename path (`#342`) moves it with the
  cache and assignments, a failure being said beside toil's own warnings. The sync's
  forget of a dossier toil no longer has calls an `onForget` hook. A stale key (a rename
  or removal done outside Toil UI) is only a name nobody asks for; the file is read
  entry by entry, so a bad entry or a broken file is no memory and never a failed start.
- **The hint is a few words, not a paragraph (principle 11).** "(last used on this
  dossier)", "(your default)" or "(picked for this chat)" sit beside "Answered by"; the
  (i) popover and the Agent help topic carry one sentence of the rule.
- **Not verified in the sample.** `toil-ui --sample` has no dossier-agents file and its
  only ready agent is the scripted one, so the memory is covered by tests and a real run
  only.
