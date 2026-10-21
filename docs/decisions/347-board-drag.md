# A board with no buttons on its cards (#347)

- **No `@dnd-kit/sortable`.** A card's place within its column comes from its tracker,
  and a drop only proposes a status change, so there is no order to change and nothing
  for sortable to do. `@dnd-kit/core` is still the only drag library.
- **A finger picks a card up after a 250 ms hold, not after a movement threshold.** The
  issue asks for a small movement threshold, which is what the mouse and the pen get
  (6 px). On touch, a movement threshold would take every swipe that starts on a card,
  and on a phone the cards fill the screen, so the page couldn't scroll. The pointer
  sensor ignores touch for the same reason: both sensors would answer one touch, and
  the first to claim it wins.
- **A long press is a hold that ends where it began** (within 10 px). iOS Safari sends
  no `contextmenu`, so the hold that would start a drag opens the card's menu instead
  when the finger lifts without moving.
- **A click anywhere on a card opens the item**, as the key's link does. The key's link
  keeps its own Enter and its browser menu (open in a new tab); Space and Enter on the
  card itself pick it up, as the issue asks, so the card is its own dnd-kit activator.
- **The card is a named group** (`role="group"`, `aria-roledescription="draggable
  card"`, named by its key and title), not dnd-kit's default `button`. A button can't
  hold the key's link (axe's `nested-interactive`), and the group's name is its own
  visible text (WCAG 2.5.3).
- **Arrow keys move a lifted card a whole column at a time**, Right or Down to the next
  and Left or Up to the previous, so the same keys work at 375 px, where the columns
  stack, and on a wide screen. dnd-kit's default moves 25 px a press.
- **Assign moved into the card's menu**, beside Open and Move to, so the card carries
  no button at all. The item page keeps its Assign to agent button.
- **Insight icons are drawn as inline SVG paths** in `src/components/bits.tsx`, one per
  insight code, in the chip's colour. Each chip keeps its word as text: a screen reader
  reads it, a mouse gets it as the tooltip (`title`), and it shows beside the icon
  while the card has keyboard focus, so a sighted keyboard user doesn't decode icons.
