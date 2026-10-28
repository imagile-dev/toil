# Toil UI keeps its session across a reload (#485)

- **The launch token stays.** The server can run toil with the person's own
  connections, change config and run the agent. Host, Origin and CSRF checks keep other
  web pages out; nothing but the token keeps other local processes or other users on the
  machine out. Dropping it to make reloads work would trade that away for a convenience.
- **The tab keeps the session in `sessionStorage`,** the session id and its CSRF token,
  and a reload asks `GET api/session` whether the server still knows it. The token itself
  is never stored; it still leaves the address bar on sign-in.
- **Not a cookie,** for the reason the design already had: a browser sends a cookie to
  every port on `127.0.0.1`, so any other local server would receive the session.
  `sessionStorage` is scoped to the exact origin (port included) and is never sent by the
  browser; the page puts the id in a header itself.
- **Not `localStorage`:** it outlives the tab and the server, so a session id would sit on
  disk long after the server that issued it has gone. `sessionStorage` goes with the tab.
- **What still needs the launch URL:** a new tab, a closed tab, and a restarted `toil-ui`
  (sessions are in memory; a restart prints a new token). The error for a restart says so,
  and the stale entry is cleared. Where the browser refuses storage, the page works until
  its next reload, as before.
- **Where the reasoning lives:** the header comments of `ui/server/server.ts` and
  `ui/src/server-client.ts`, and "Start it" in `ui/README.md`, so the next person
  wondering why this isn't a cookie, or why there is a token at all, finds it beside the
  code.
