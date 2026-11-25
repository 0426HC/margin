#!/bin/bash
# What the background service runs (launchd starts it at login and restarts it if it stops).
# Serves the current release's production build with your real data folder, on your Mac only (127.0.0.1).
. "$(dirname "$0")/lib.sh"

[ -f "$APP/env.sh" ] || die "run scripts/mac/setup.sh first."
[ -e "$APP/current" ] || die "no build yet: run .mac-app/bin/update.sh."

mkdir -p "$LOG"
# keep the log small: start it over once it passes 5 MB
if [ -f "$LOG/server.log" ] && [ "$(stat -f %z "$LOG/server.log")" -gt 5000000 ]; then
  mv -f "$LOG/server.log" "$LOG/server.old.log"
fi

cd "$APP/current"
export NODE_ENV=production
export MARGIN_DATA_DIR="$DATA"          # without this a production build would look in ~/Library/Application Support/Margin
export MARGIN_CLAUDE_BIN="$CLAUDE_BIN"  # the official claude CLI, found by absolute path
echo "$(date '+%Y-%m-%d %H:%M:%S') starting $(basename "$(readlink "$APP/current")") on port $PORT"
exec "$NODE_BIN" node_modules/next/dist/bin/next start -p "$PORT" -H 127.0.0.1
