# The splash's data: Realm's d20 lands on the sprint's day (#462)

- **Remembered from the last load, in this browser.** The splash plays while the first read
  runs and ends the moment that read is done, so it can neither wait for the sprint nor see
  it arrive: "update the splash's text slot if the data arrives before it hands over" never
  happens, because the data arriving is what ends it. So each time a dossier's page loads
  (`App`, the dossier on screen), the browser remembers that dossier's sprint: its start, its
  end and the items done in it (`ui/src/moments/splash-data.ts`, localStorage
  `toil-ui:splash`, beside `toil-ui:looked`). The next launch on that dossier's page reads it
  once, as the App mounts, and works the day out from the dates at the App's clock with the
  same weekday count the dashboard uses (`sprintDays`, split out of `health` in
  `ui/src/model/sprint.ts`), so the splash's day and the page's "day 7 of 10" agree, except
  before a sprint's first weekday, when the page says day 0 and the die, which has no 0, says 1.
  The splash never waits for anything.
- **Why the browser and not the server's cache.** The server's cache holds the last sync, but
  reaching it means a read, which is the wait the splash covers; handing it over in the
  session would add the sprint model to the server for one number. The browser already keeps
  what the dashboard was handed, and what it remembers is dates and a count, nothing a
  tracker said in words. Per browser, never sent anywhere; a renamed dossier keeps its entry,
  as `looked.ts` does.
- **What falls back.** Nothing remembered, storage off or unreadable, the dossiers list or
  Settings (no dossier is opening), a sprint not begun or already ended at the App's clock,
  a dossier whose sprint went away (its entry is forgotten on the next load), and sample
  data, which neither remembers nor reads. In each the splash is handed nothing and renders
  exactly what it did before: the same single `img`, no face, no data attributes.
- **Items done is as of the last load.** The day is worked out fresh; the count isn't, since
  it can only come from the items. It is what the dashboard showed last, which is what the
  cache serves until the next sync. Only a data attribute carries it today.
- **How it reaches a theme: a face and data attributes, nothing else.** A theme declares
  `splash.face`, `{ "value": "sprint-day" | "items-done", "max": n }`, in its `theme.json`;
  the engine writes the number as text in a `.m-face` span, and puts `data-sprint-day`,
  `data-sprint-days`, `data-items-done` and `data-dossier` on `.splash`. Numbers and a name,
  rendered by React as text and attribute values, so there is nothing a theme could run. The
  theme rules refuse any other face value or key.
- **The face rides in the holder that arrives.** A splash with a face renders its art as #451's
  holder span (`.m-hold`, carrying `.splash__art`) with the picture and the face inside it, so
  the engine's arrival moves the die and its number together and neither carries a second
  animation. The holder is used only when there's a face or a loop; with neither the art is one
  `img`, as before. `ui/test/one-animation.test.tsx` now plays the splash both ways.
- **Capped, not wrapped, at 20.** A sprint longer than twenty working days is rare; wrapping
  would land day 23 on a 3, which reads as early in the sprint when it's late. Capping lands
  the end of a long sprint on 20, the die's natural rest. Day 1 is the floor (a sprint that
  starts at a weekend reads as day 1 until its first weekday).
- **Realm's number covers the drawn 20 rather than a second die.** #440 holds Realm to one d20
  asset, used by the loader and the Natural 20 too, which both show the 20. So the face is a
  triangle of the face's own oxblood, laid just inside its gold edges, in the SVG's serif and
  colour, over the drawn number. Without a day there's no face, and the die is untouched.
- **Other themes ignore it.** None has a picture with a natural place for a number, and adding
  one to a splash line or the progress text would be clutter (principle 11). They get the data
  attributes, which do nothing until a theme's stylesheet uses them.
- **The Settings preview shows a sample sprint.** The splash's preview is handed day 7 of 10 of
  card-payments, as the loader's preview shows a sample read, so a person can see their theme's
  face without waiting for a launch, and the layout check sees it in every theme. It's a
  preview, so it doesn't need a remembered sprint.
- **Only the splash.** The loader's tumbling d20 and the Natural 20 moment keep their 20: the
  loader covers waits other than a launch, and a natural 20 is the point of that one.
