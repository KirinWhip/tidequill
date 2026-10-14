#!/usr/bin/env bash
# Run the Playwright E2E suite on Linux under Xvfb with an unlocked gnome-keyring (so safeStorage is available).
set -e
cd "$(dirname "$0")/.."
exec dbus-run-session -- bash -c '
  eval "$(echo -n e2e | gnome-keyring-daemon --unlock --components=secrets)" >/dev/null
  export EXPECT_SAFE_STORAGE=1 E2E_EXTRA_ARGS=--password-store=gnome-libsecret
  xvfb-run -a -s "-screen 0 1600x2000x24" npx playwright test "$@"
' bash "$@"
