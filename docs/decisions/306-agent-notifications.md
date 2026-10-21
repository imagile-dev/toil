# Notify on agent state changes, never on events (#306)

- **Notices live in the page, under the header, in its flow.** The issue's "in-page
  badge" is a notice strip with Dismiss, not a fixed toast: the layout check refuses
  anything fixed over the page's end, and a strip in the flow reads in order for a
  screen reader (`role="status"`). `ui/src/components/notify.tsx`.
- **The title count runs whenever the tab is hidden**, quiet hours included; the
  browser's own notification fires only while the tab is hidden, only with Browser
  notifications on and the permission granted. With the tab in view the strip is
  enough, so nothing pops up twice.
- **The window is four seconds** (`WINDOW_MS`), from the first change it gathers. Per
  session the last change wins; a session that ends the window where it started, or
  on a state that is switched off, sends nothing. So needs you then done, with done
  off, is silent: the question was answered elsewhere.
- **Defaults:** needs you, failed and the usage cap on, done off, stale on. The issue
  sets the first three; a cap is a failure the person must act on, and stale is the
  point of #305, so both default on.
- **A person's own Stop never notifies**, and neither does queued to working: neither
  is news to the person watching.
- **"Only for agents I started" means started in this browser:** its chats, and the
  assignments it assigned, started or renewed (the Command Center's start included),
  remembered in this browser (the last 500 ids). An assignment started by another
  browser or a program on `api/assignments` isn't the person's here.
- **Events carry what a notice says** (`itemTitle`, `adapter`, `origin`, `stop`,
  `pending`, `questions`), so the page needs no second read, and the stream takes
  `since=latest` to skip the events already kept: a page that opens never notifies
  about what happened before it.
- **Stale assignments are found by a minute's read of the dossier on screen**, since
  staleness is worked out on read and has no event. What the first read finds stale
  is known already and doesn't notify; a session that goes stale later does, once. A
  chat notifies once per session: its key carries its renewals.
- **Settings live in this browser** (`toil-ui.notify` in its storage), beside the
  theme and motion choices, never in toil's config or on the server.
