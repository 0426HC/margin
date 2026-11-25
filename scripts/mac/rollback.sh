#!/bin/bash
# Go back to the previous build and restart. Run it again to return to the newer one.
# Your data is not touched; to also restore data from a backup, see restore-data.sh.
. "$(dirname "$0")/lib.sh"

[ -L "$APP/previous" ] || die "there is no previous build to go back to."
cur="$(readlink "$APP/current")"
prev="$(readlink "$APP/previous")"
[ -d "$prev" ] || die "the previous build folder is gone ($prev)."

say "Switching from $(basename "$cur") to $(basename "$prev")"
switch_to "$prev"
if restart_service; then
  if wait_healthy 60; then
    say "Done: Margin is running $(basename "$prev"). Run rollback.sh again to return to $(basename "$cur")."
    notify "Rolled back to $(basename "$prev")."
  else
    die "the previous build didn't answer within a minute. See .mac-app/logs/server.log."
  fi
else
  say "Switched. The background service isn't installed, so start it as in docs/mac-app.md."
fi
