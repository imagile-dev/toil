# The layout check's board drag waits on what it needs (#404)

- **The cause was a Menu left open from the width before.** At 375 and 768px the
  board's only state is the compact header's Menu, closed with one Escape. On a
  loaded runner that Escape can land before the Menu's popover has focus, so the
  Menu stays open into the next width. A React Aria popover covers the page with
  its underlay, so the drag's real mouse press lands on it, closes the Menu, and
  no card is picked up: no copy, no placeholder, no ghost, the three problems CI
  reported on `checkout-web/board` at 768px. The other states already guarded
  against this with `clearOverlays`; the drag didn't.
- **Before the drag, `closeOverlays` closes anything still open**, the same way
  `clearOverlays` states always did (focus inside, Escape), now shared by both and
  waiting until the dialog count drops rather than a fixed 300ms. A dialog still
  open after three tries fails the drag with its label.
- **The press is hit-tested first.** If `elementFromPoint` at the grip isn't the
  card's grip, the check fails saying what covers it, instead of three problems
  that read as a broken drag.
- **Every wait in the drag is on a condition, 5s at most** (`until`): the card
  picked up after a finger's hold (instead of 350ms), the copy under the pointer
  with its verdict and the placeholder in the column (instead of 150ms), the ghost
  in the target column (instead of 300ms) and gone after Undo (instead of 200ms).
  Each failure says what didn't show within 5s. The 16ms between moves stays: it
  is a hand's pace, not a wait for anything.
- **The fix stays in the check, not the app.** The Menu closing on Escape is
  correct; only the check's timing assumed it closed in time.
