# Ask with training wheels (#552, slice 3)

- **The guided start replaces the starter chips, in the UI only.** The nine questions
  live in `ui/src/guided-questions.ts`; the server's `STARTERS` still back
  `api/agent/starters` and the scripted agent's starters, so the server, `verify:ui` and the
  ticket banner's "is this a starter" check are unchanged. Pressing a question sends its
  text, as typing it would; "Who might need help?" relies on the system prompt's rule that
  the agent never ranks people, and its "Good for" line says so.
- **Analyze lost its Ask bar button** and is the first question. The palette entry and the
  Analyses tab buttons stay; there was no keyboard shortcut to keep.
- **"How sure" uses the dossier's items as its base** (`< 3` is Low), not the items an
  answer cites, since an aggregate answer ("3 of 21 points") cites few. Age is `Data.now`
  against the wall clock; the sample sets `viewedAt` two hours after its fixed `now`, so it
  does not read as ten days old.
- **The no-agent notice is two strings:** `NO_AGENT_NOTICE` (plain) and `NO_AGENT_DETAILS`
  (packages). The server's error keeps the packages in its `fix`.
- **The themed empty-state art is not drawn in the chat's start** (it was the only user of
  the skin `EmptyState` there); the themed placeholder stays.
- **The sample agent** answers five of the nine questions from its existing scripts (finish,
  blocking, review, help, boss), the briefing as Analyze, and says it has no script for the
  other three (changed, waiting, ready) rather than answer a question it wasn't asked.
