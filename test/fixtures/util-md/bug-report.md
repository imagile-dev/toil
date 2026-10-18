# Sign-in button does nothing in Safari 17

**Reporter:** QA, nightly regression run · **Build:** `2026.10.14-rc2`

## Summary

On the login page at https://app.imagile.dev/login the *Sign in* button
doesn't submit the form in Safari 17.4. Chrome and Firefox are fine. This
started after [PR #4821](https://git.imagile.dev/web/app/pull/4821 "Move auth to the new client") merged.

## Steps to reproduce

1. Open https://app.imagile.dev/login in Safari 17.4 (macOS 14.4)
2. Enter a valid user, e.g. `qa-user-07`
3. Press **Sign in**
   - Nothing happens; no request appears in the network tab
   - The console shows one error (below)
4. Reload and try again: same result

## Expected

The form posts to `/api/session` and redirects to the dashboard.

## Console output

```text
TypeError: undefined is not an object (evaluating 'window.authClient.signIn')
    at onSubmit (login.4f2a9c.js:1:20431)
```

## Environment

| Browser | Version | OS | Result |
|:--------|--------:|:--:|--------|
| Safari | 17.4 | macOS 14.4 | **fails** |
| Chrome | 130 | macOS 14.4 | passes |
| Firefox | 131 | Windows 11 | passes |

## Checklist

- [x] Reproduced on a second machine
- [x] Attached a HAR file
- [ ] Checked Safari Technology Preview
- [ ] Confirmed with the auth team

> **Note:** the workaround for affected users is to use the *Forgot password*
> link, which signs them in after the reset. ~~Clearing the cache~~ doesn't help.

Related: PROJ-4790, and the runbook at <https://wiki.imagile.dev/display/WEB/Auth+runbook>.
