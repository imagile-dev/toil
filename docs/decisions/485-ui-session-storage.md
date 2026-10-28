# Toil UI keeps its session across a reload (#485)

- **The launch token stays.** The server can run toil with the person's own
  connections, change config and run the agent. Host, Origin and CSRF checks keep other
  web pages out; nothing but the token keeps other local processes or other users on the
  machine out. Dropping it to make reloads work would trade that away for a convenience.
- **The tab keeps the session id in `sessionStorage`,** and a reload asks
  `GET api/session` whether the server still knows it; the answer carries the CSRF token
  and the rest, so only the id is stored. The launch token itself is never stored; it
  still leaves the address bar on sign-in.
- **Not a cookie,** for the reason the design already had: a browser sends a cookie to
  every port on `127.0.0.1`, so any other local server would receive the session.
  `sessionStorage` is scoped to the exact origin (port included) and is never sent by the
  browser; the page puts the id in a header itself.
- **Not `localStorage`:** it outlives the tab and the browser, so an id would linger long
  after the server that issued it has gone. `sessionStorage` is the tab's, though a browser
  may copy it into a duplicated tab or save it to restore a closed one, so while the same
  `toil-ui` runs such a tab comes back signed in. A restart ends every session, so a stale
  id is refused.
- **What still needs the launch URL:** a new tab, and any tab after `toil-ui` restarts
  (sessions are in memory; a restart prints a new token). The error for a restart says so,
  and the stale entry is cleared. Where the browser refuses storage, the page works until
  its next reload, as before; the reload then says the tab has no session and to open the
  launch URL, without saying why (a notice at sign-in would be the alternative; the
  message already says what to do, so it stays simple).
- **This supersedes** the "trade-off" bullet in `AGENT_DECISIONS.md` under "The launch
  token, and no cookie" (review round 1), which refused `sessionStorage` because a script
  on the origin could read it. A script on the page can read an in-memory id just the
  same, and the CSP (`script-src 'self'`) keeps other scripts off the origin. That file is a
  frozen archive, so it is not edited.
- **Where the reasoning lives:** the header comments of `ui/server/server.ts` and
  `ui/src/server-client.ts`, and "Start it" in `ui/README.md`, so the next person
  wondering why this isn't a cookie, or why there is a token at all, finds it beside the
  code.
