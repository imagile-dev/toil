#!/usr/bin/env bash
# Runs the live OS credential store round trip (test/live/) against the
# platform's real store. macOS uses the runner's login Keychain as it is.
# Linux has no desktop session on a runner, so this starts a private D-Bus
# session and a GNOME Keyring unlocked with a throwaway password, both gone
# when the session ends. Needs libsecret-tools and gnome-keyring on Linux.
set -euo pipefail

case "$(uname -s)" in
  Darwin)
    security default-keychain
    npm run test:keychain-live
    ;;
  Linux)
    # shellcheck disable=SC2016 # expanded by the inner shell, inside the session
    dbus-run-session -- bash -euo pipefail -c '
      head -c 24 /dev/urandom | base64 | gnome-keyring-daemon --unlock --components=secrets >/dev/null
      npm run test:keychain-live
    '
    ;;
  *)
    echo "keychain-live: no live store test for $(uname -s)" >&2
    exit 1
    ;;
esac
