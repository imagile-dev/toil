# What a board drag shows while it happens and after (#393)

- **The card that moves is a copy in dnd-kit's `DragOverlay`, rendered in a portal on
  `<body>`.** The card itself stays in its column as a dashed, faded placeholder. A
  transform on the card itself moves it only inside the board's own boxes: the board
  scrolls sideways (`overflow-x: auto`), which clips both axes, and a theme's panel
  may be transformed or filtered, which would offset a fixed copy. A portal escapes
  both. Still no `@dnd-kit/sortable` (`docs/decisions/347-board-drag.md`).
- **The copy says what a drop would do** ("Drop to propose: In progress", or "Already
  in To do: nothing to propose"), and the column under it is outlined in the focus
  colour as a target, or dashed in the danger colour when it would refuse. The reason
  goes on the copy rather than in the column, because the copy is where the person is
  looking, and adding a line to the column would shift every droppable mid-drag.
  `dropVerdict` holds the same rule `proposeMove` does: the card's own column and
  Unknown propose nothing.
- **The copy is `aria-hidden` and holds no link.** dnd-kit's announcements already say
  what is picked up, where it is and what a drop did, so a second named card would
  only be read twice.
- **No drop animation, in any motion setting.** On a drop the card doesn't move (the
  tracker hasn't changed), so dnd-kit's default, flying the copy back to the card,
  would read as "refused". The copy vanishes where it was dropped and the ghost is
  there. Reduced motion only drops the ghost's short fade-in.
- **After any move (drag, keyboard or the card's menu) a ghost sits at the top of the
  target column**: "Proposed move, not applied", the key and title, where it came
  from, Undo, and How to apply. It is a list item but not a `.card`, has no drag
  handle, and the column's count stays the tracker's. The "Proposed moves" list under
  the board stays, with the command.
- **How to apply is a button that scrolls to the proposal's card and focuses it**, not
  a link: the app routes on the hash, so an in-page `#anchor` would navigate away.
  There's still no button that applies anything (principle 2); the command is on the
  proposal's card.
- **Undo removes the proposal and hands focus back to the card**, which never left its
  column, and says so in the board's status line.
- **The regression check drives real input.** `scripts/layout-check.mjs` drags a card
  on every dossier dashboard, in every theme at 375, 768 and 1440px, through
  `Input.dispatchMouseEvent` (and `Input.dispatchTouchEvent` with touch emulation at
  375px), and fails unless the copy is under the pointer mid-drag, the card left a
  placeholder, and a ghost is in the target column after the drop. The dropped state
  goes through the same layout and axe checks as every other state. `chrome.mjs`
  gained `mouse`, `touch` and `touchscreen` for it.
