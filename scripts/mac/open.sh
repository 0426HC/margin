#!/bin/bash
# What the Margin icon in the Dock runs: make sure the background service answers, then open Margin in its own
# app-style Chrome window (no tabs, no address bar).
. "$(dirname "$0")/lib.sh"

if ! wait_healthy 1; then
  # not answering: ask launchd to start it (harmless if it is already starting), then give it a moment
  launchctl kickstart "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
  if ! wait_healthy 30; then
    /usr/bin/osascript -e "display alert \"Margin isn’t running\" message \"The background service didn’t start. In Terminal, run:\n$APP/bin/service.sh status\n\nThe log is $LOG/server.log\" as warning" >/dev/null
    exit 1
  fi
fi

# Margin gets its own Chrome profile, kept in .mac-app (git-ignored), with extensions turned off: in your everyday profile every extension
# ran inside Margin and the window shared one Chrome with all your tabs. Being a separate profile, it is a separate Chrome: the first open
# starts it, later opens hand the window to it.
# -n: a new Chrome launch, so --app is honoured even when Chrome is already open.
mkdir -p "$APP/chrome-profile"
exec /usr/bin/open -na "Google Chrome" --args --user-data-dir="$APP/chrome-profile" --disable-extensions --no-first-run --no-default-browser-check --app="$(URL)" --new-window
