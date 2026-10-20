# Showing that a pasted secret arrived (#358)

- **A password may hold a space; a token may not.** The issue refuses a space in the
  middle as a two-line paste. People put spaces in passwords, so a secret an area
  declares as a `password` refuses only a line break in the middle; every other secret
  refuses a space or tab too. `checkSecret()` in `src/core/secret-input.ts`.
- **The mid-value check runs inside any wrapper.** `Bearer abc` is asked about rather
  than refused for its space, and kept as typed when the person answers no.
- **Quotes include backticks and curly quotes**, and a prefix is `Bearer` or `token`
  in any case followed by spaces or tabs. A lone `token` is a value, not a prefix.
- **A line break that arrives with other text in one chunk is a paste, not Enter.**
  Bracketed paste is turned on while a secret is read, which Windows Terminal,
  conhost through ConPTY, macOS Terminal and xterm-likes all pass through (checked on
  ConPTY with pywinpty). For a terminal that doesn't bracket, a chunk that is more
  than a line break keeps its line breaks as text, so the check can report them and
  the rest of a split paste never types itself into the next question. The cost: a
  line typed ahead and Enter in one chunk needs a second Enter.
- **Removing a wrapper is said on its own line** (`Removed "Bearer ": 19 characters
  left.`), after the `Received` line, so the length the person sees last is the one
  stored.
- **`login` on a key with nothing stored skips it on an empty answer** rather than
  saying `Kept the existing secret.`, since there is none; with something stored it
  says the issue's line. The marketplace token (`skills marketplace add`) goes
  through the same checks, keeping a stored token on an empty answer.
- **A host's person is asked once.** A refused or empty required secret is
  `INVALID_INPUT` with the terminal's words, and the wrapper is the visible question
  `unwrap:<key>` (`y` or `n`); an unanswered one is `CANCELLED`, as every other
  question is, so nothing is ever removed silently.
- **Toil UI's page imports `checkSecret` from toil's source**, as it already does the
  OWI mappers and the similarity index: the module is pure, and the published API
  exports the same function for other hosts. The UI's note shows the length and the
  trim live; a refusal shows live too, since a browser would otherwise join a
  two-line paste silently; the wrapper question appears on submit, with Remove it and
  Keep it, and the person saves again after choosing.
- **A paste with a line break is kept as it came.** A browser strips line breaks from
  a password field's value, which would join two pasted lines without a word. The
  field takes such a paste itself so the check sees it; typing over it afterwards
  goes back to what the browser holds.
- **Bracketed paste is turned off on an abnormal exit too**, best effort, from a
  `process` exit hook held only while a secret is being read, so a shell after a
  crashed toil doesn't see paste markers. No principle says toil must restore
  terminal state after an abnormal exit; this is the cheap half of it.
- **A lone Esc is dropped and the key after it kept**, so Esc then Enter still
  ends the line. Alt+key reads as the key.
- **Editing keys don't make a chunk text.** Backspace or Ctrl+U arriving in one
  chunk with Enter is still Enter; only printable text typed outside a paste turns
  a line break into part of the answer.
- **The empty-keep rule in Toil UI follows the file, as the CLI's does:** a secret
  whose value comes from the store or the file is kept on an empty field; one that
  only an env var supplies isn't in the file, so an empty field stores nothing.
