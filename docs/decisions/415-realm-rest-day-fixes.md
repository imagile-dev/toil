# Realm's rest days: today and the calendar's loading line (#415)

- **Today is never a rest.** An empty calendar cell for today now carries
  `data-today`, like a linked day does, and Realm's camp fire skips it: a morning
  before anything is logged isn't a past day. Its screen-reader text says ", today"
  too, as a linked today already did (`ui/src/views/Worklog.tsx`).
- **"Camp fires mark rest days." shows only under a calendar.** The worklog panel's
  body is the calendar, its loading line or a failed read; the line is hidden by CSS
  unless it follows a `.calendar`, so it never explains fires that aren't there
  (principle 11). CSS rather than a prop, because the panel skin only sees its
  children.
